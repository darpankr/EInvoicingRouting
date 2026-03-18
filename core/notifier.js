import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

// =========================================================================
// SES CLIENT & CONFIGURATION
// =========================================================================
const sesClient = new SESv2Client({ region: process.env.AWS_REGION_NAME });
const SENDER_EMAIL = process.env.SENDER_EMAIL;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(',').filter(e => e.trim().length > 0);

// =========================================================================
// SEND ERROR NOTIFICATION EMAIL
// =========================================================================
export async function sendErrorNotification(
    category,
    subcategory,
    errorMessage,
    rawBody,
    priority,
    environment,
    webhookId,
    statusCode = 200,
    targetSystem = "System",
    countryCode = null
) {
    const istTime = new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    // Source system is always Fonoa
    const sourceSystem = "Fonoa";

    // Extract webhook details from raw body
    let resourceId = "N/A";
    let eventType = "N/A";
    let deliveredAt = "N/A";

    try {
        const parsed = JSON.parse(rawBody);
        resourceId = parsed.resource_id || "N/A";
        eventType = parsed.event_type || "N/A";
        deliveredAt = parsed.delivered_at || "N/A";
    } catch (e) {
        console.error("Email Helper: Parse failed");
    }

    const displayCountryCode = countryCode || "N/A";

    // Email styling
    const tableStyle = "width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 15px; font-family: 'Segoe UI', Arial, sans-serif;";
    const labelStyle = "padding: 10px; border: 1px solid #dee2e6; background-color: #f8f9fa; font-weight: bold; width: 35%; color: #555;";
    const valueStyle = "padding: 10px; border: 1px solid #dee2e6; color: #333;";

    // Priority-based subject prefix
    let subjectPrefix = "Fonoa-AWS Webhook Alert";
    if (priority === "Critical" || priority === "High") {
        subjectPrefix = "🚨 URGENT - Fonoa-AWS Alert";
    } else if (priority === "Medium") {
        subjectPrefix = "Fonoa-AWS-NetSuite Alert";
    }

    try {
        await sesClient.send(new SendEmailCommand({
            FromEmailAddress: SENDER_EMAIL,
            Destination: { ToAddresses: ADMIN_EMAILS },
            Content: {
                Simple: {
                    Subject: { Data: `${subjectPrefix} | ${category}` },
                    Body: {
                        Html: {
                            Data: `
                                <div style="font-family: Arial, sans-serif; max-width: 650px; color: #333; line-height: 1.5;">
                                    <p>Dear Team,</p>
                                    <p>A transaction failure has been detected in the Fonoa-AWS integration system.</p>
                                    
                                    <table style="${tableStyle}">
                                        <tr>
                                            <td style="${labelStyle}">Environment</td>
                                            <td style="${valueStyle}">${environment}</td>
                                        </tr>
                                        <tr>
                                            <td style="${labelStyle}">Source System</td>
                                            <td style="${valueStyle}"><strong>Fonoa</strong></td>
                                        </tr>
                                        ${targetSystem !== "N/A" ? `
                                        <tr>
                                            <td style="${labelStyle}">Target System</td>
                                            <td style="${valueStyle}"><strong>${targetSystem}</strong></td>
                                        </tr>
                                        ` : ''}
                                        <tr>
                                            <td style="${labelStyle}">Priority</td>
                                            <td style="${valueStyle}"><strong>${priority}</strong></td>
                                        </tr>
                                        <tr>
                                            <td style="${labelStyle}">Webhook ID</td>
                                            <td style="${valueStyle}">${webhookId}</td>
                                        </tr>
                                        <tr>
                                            <td style="${labelStyle}">Resource ID</td>
                                            <td style="${valueStyle}">${resourceId}</td>
                                        </tr>
                                        <tr>
                                            <td style="${labelStyle}">Country Code</td>
                                            <td style="${valueStyle}">${displayCountryCode}</td>
                                        </tr>
                                        <tr>
                                            <td style="${labelStyle}">Event Type</td>
                                            <td style="${valueStyle}">${eventType}</td>
                                        </tr>
                                        <tr>
                                            <td style="${labelStyle}">Status Code Returned</td>
                                            <td style="${valueStyle}">${statusCode}</td>
                                        </tr>
                                        <tr>
                                            <td style="${labelStyle}">Time (IST)</td>
                                            <td style="${valueStyle}">${istTime}</td>
                                        </tr>
                                        <tr style="background-color: #fff5f5;">
                                            <td style="${labelStyle} border-color: #f5c6cb; color: #b91c1c;">Error Category</td>
                                            <td style="${valueStyle} border-color: #f5c6cb; color: #b91c1c;">
                                                <strong>${category} - ${subcategory}</strong>
                                            </td>
                                        </tr>
                                        <tr style="background-color: #fff5f5;">
                                            <td style="${labelStyle} border-color: #f5c6cb; color: #b91c1c;">Error Details</td>
                                            <td style="${valueStyle} border-color: #f5c6cb; color: #b91c1c; font-family: monospace; font-size: 12px;">
                                                ${errorMessage}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style="${labelStyle}">Request Body</td>
                                            <td style="${valueStyle}"><pre style="font-size: 11px; overflow-x: auto;">${rawBody}</pre></td>
                                        </tr>
                                    </table>

                                    <p style="margin-top: 20px;">For further investigation, please refer to the AWS CloudWatch logs for this execution.</p>

                                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #dee2e6;">
                                    
                                    <p style="font-size: 13px; color: #666;">
                                        <strong>Manual Retry Instructions:</strong><br/>
                                        To manually retry this webhook, invoke the Lambda function with the following JSON payload:
                                    </p>
                                    
                                    <pre style="background-color: #f8f9fa; padding: 10px; border-radius: 4px; font-size: 12px; overflow-x: auto;">
{
  "isManualSync": true,
  "resource_id": "${resourceId}",
  "webhook_id": "${webhookId}"
}</pre>

                                    <p style="font-size: 12px; color: #999; margin-top: 30px;">
                                        This is an automated notification from the Fonoa Multi-System Router.
                                    </p>
                                </div>
                            `
                        }
                    }
                }
            }
        }));

        console.log(`Error notification email sent successfully to: ${ADMIN_EMAILS.join(', ')}`);
    } catch (err) {
        console.error(`Failed to send error notification email: ${err.message}`);
        throw err;
    }
}