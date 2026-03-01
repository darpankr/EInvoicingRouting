import { PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import crypto from 'crypto';
import { sendErrorNotification } from './notifier.js';

// =========================================================================
// CONFIGURATION
// =========================================================================
const RETENTION_PERIOD_SECONDS = 7 * 24 * 60 * 60; // 7 days TTL
const STALE_LOCK_TIMEOUT = 300; // 5 minutes for hung processes

// =========================================================================
// ACQUIRE LOCK (Idempotency Check)
// =========================================================================
export async function acquireLock(docClient, tableName, webhookId) {
    const now = Math.floor(Date.now() / 1000);

    try {
        // Try to create a new lock for first-time webhook
        await docClient.send(new PutCommand({
            TableName: tableName,
            Item: {
                webhook_id: webhookId,
                status: "IN_PROGRESS",
                last_updated: now,
                email_sent: false,
                expiration: now + RETENTION_PERIOD_SECONDS
            },
            ConditionExpression: "attribute_not_exists(webhook_id)"
        }));

        console.log(`Idempotency lock acquired: ${webhookId}`);
        return "PROCEED";

    } catch (dbErr) {
        // Handle DynamoDB errors
        if (dbErr.name === "ResourceNotFoundException") {
            throw new Error(`DATABASE_OFFLINE: Table '${tableName}' not found`);
        }

        if (dbErr.name === "ConditionalCheckFailedException") {
            // Webhook already exists - check its status
            const existing = await docClient.send(new GetCommand({
                TableName: tableName,
                Key: { webhook_id: webhookId }
            }));

            const item = existing.Item;

            // Already completed successfully
            if (item?.status === "COMPLETED") {
                return "COMPLETED";
            }

            // Check if we can reclaim the lock
            const isFailed = item?.status === "FAILED_RETRYING";
            const isStale = item?.status === "IN_PROGRESS" && 
                           (now - (item?.last_updated || 0) > STALE_LOCK_TIMEOUT);

            if (isFailed || isStale) {
                console.warn(`Re-claiming lock. Reason: ${isFailed ? 'Previous failure' : 'Stale lock'}`);
                
                // Update to IN_PROGRESS
                await docClient.send(new UpdateCommand({
                    TableName: tableName,
                    Key: { webhook_id: webhookId },
                    UpdateExpression: "SET #s = :s, last_updated = :now, expiration = :exp",
                    ExpressionAttributeNames: { "#s": "status" },
                    ExpressionAttributeValues: {
                        ":s": "IN_PROGRESS",
                        ":now": now,
                        ":exp": now + RETENTION_PERIOD_SECONDS
                    }
                }));

                return "PROCEED";
            }

            // Still being processed by another execution
            return "LOCKED";
        }

        // Other database errors
        throw new Error(`DATABASE_OFFLINE: ${dbErr.message}`);
    }
}

// =========================================================================
// MARK AS COMPLETED
// =========================================================================
export async function markCompleted(docClient, tableName, webhookId) {
    try {
        await docClient.send(new UpdateCommand({
            TableName: tableName,
            Key: { webhook_id: webhookId },
            UpdateExpression: "SET #s = :s",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":s": "COMPLETED" }
        }));

        console.log(`Webhook marked as COMPLETED: ${webhookId}`);
    } catch (err) {
        console.error(`Failed to mark webhook as completed: ${err.message}`);
        // Don't throw - we don't want to fail the entire request if this fails
    }
}

// =========================================================================
// MARK AS FAILED (with email notification and retry logic)
// =========================================================================
export async function markFailed(
    docClient,
    tableName,
    webhookId,
    errorMessage,
    category,
    subcategory,
    rawBody,
    priority,
    environment,
    shouldRetry = false,
    trackInTable = true,
    system = "System"
) {
    // If we shouldn't track in table, just send email and return
    if (!trackInTable || webhookId === "UNKNOWN" || webhookId === "MISSING_ID" || !webhookId) {
        console.log("Sending email without DynamoDB tracking (trackInTable=false or invalid webhook_id)");
        try {
            await sendErrorNotification(
                category,
                subcategory,
                errorMessage,
                rawBody,
                priority,
                environment,
                webhookId,
                shouldRetry ? 500 : 200,
                system
            );
        } catch (sesError) {
            console.error(`Critical: SES Failed to send alert: ${sesError.message}`);
        }
        return;
    }

    const now = Math.floor(Date.now() / 1000);
    const statusUpdate = shouldRetry ? "FAILED_RETRYING" : "FAILED_FATAL";
    const msgFingerprint = crypto.createHash('md5').update(errorMessage || "").digest('hex');

    try {
        // Get existing item to check if email was already sent
        const check = await docClient.send(new GetCommand({
            TableName: tableName,
            Key: { webhook_id: webhookId }
        }));

        const existingItem = check.Item;
        const isNewError = existingItem?.last_msg_hash !== msgFingerprint;
        const shouldSendEmail = !existingItem?.email_sent || isNewError;

        // 1. Update status and error details
        await docClient.send(new UpdateCommand({
            TableName: tableName,
            Key: { webhook_id: webhookId },
            UpdateExpression: "SET #s = :st, error_message = :m, expiration = :ex, last_msg_hash = :hash",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
                ":st": statusUpdate,
                ":m": (errorMessage || "Unknown error").substring(0, 1000),
                ":ex": now + RETENTION_PERIOD_SECONDS,
                ":hash": msgFingerprint
            }
        }));

        console.log(`Webhook status updated to: ${statusUpdate}`);

        // 2. Send email notification if needed
        if (shouldSendEmail) {
            try {
                await sendErrorNotification(
                    category,
                    subcategory,
                    errorMessage,
                    rawBody,
                    priority,
                    environment,
                    webhookId,
                    shouldRetry ? 500 : 200,
                    system
                );

                // Mark email as sent
                await docClient.send(new UpdateCommand({
                    TableName: tableName,
                    Key: { webhook_id: webhookId },
                    UpdateExpression: "SET email_sent = :t",
                    ExpressionAttributeValues: { ":t": true }
                }));

                console.log("Error notification sent and recorded.");
            } catch (sesError) {
                console.error(`SES Failed - will attempt again on next retry: ${sesError.message}`);
                // Email remains unsent, will retry on next failure
            }
        } else {
            console.log("Duplicate error detected. Email notification suppressed.");
        }

    } catch (err) {
        if (err.name === "ConditionalCheckFailedException") {
            console.log("Email suppression: Parallel execution already sent the alert.");
        } else {
            console.error(`Failed to track failure in DynamoDB: ${err.message}`);
        }
        // Don't throw - we still want to return a response to Fonoa
    }
}