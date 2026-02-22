import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// SES can be in a different region than the app (e.g. Beanstalk in us-west-1, SES in us-east-1).
const sesRegion = process.env.SES_REGION || process.env.AWS_REGION || "us-east-1";
const sesClient = new SESClient({ region: sesRegion });

/**
 * Sends a 2FA verification code to the specified email address using Amazon SES.
 * Requires SES_SENDER_EMAIL (verified in SES). Uses AWS SDK; no Lambda needed.
 */
export async function send2FACode(email, code) {
    const sender = process.env.SES_SENDER_EMAIL;
    if (!sender) {
        throw new Error("SES_SENDER_EMAIL environment variable is not set.");
    }

    const codeStr = String(code ?? '').trim();
    const htmlBody = `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; background-color: #0f172a; padding: 20px;">
    <div style="max-width: 400px; margin: auto; background: #1e293b; padding: 30px; border-radius: 10px; text-align: center; border: 1px solid #334155;">
        <h2 style="color: #f8fafc; margin-bottom: 20px;">Navi Admin</h2>
        <p style="font-size: 16px; color: #f1f5f9;">Your verification code is:</p>
        <table cellpadding="0" cellspacing="0" style="margin: 20px auto; border-collapse: collapse;"><tr><td style="font-size: 32px; font-weight: bold; background: #10b981; color: #0f172a; padding: 12px 24px; letter-spacing: 4px;">${codeStr}</td></tr></table>
        <p style="font-size: 14px; color: #f1f5f9; margin-top: 20px;">It expires in 10 minutes.</p>
    </div>
</body>
</html>`;

    const command = new SendEmailCommand({
        Source: sender,
        Destination: {
            ToAddresses: [email],
        },
        Message: {
            Subject: {
                Data: "Navi Admin – Verification Code",
                Charset: "UTF-8",
            },
            Body: {
                Html: {
                    Data: htmlBody,
                    Charset: "UTF-8",
                },
                Text: {
                    Data: `Your verification code is: ${codeStr}\n\nIt expires in 10 minutes.`,
                    Charset: "UTF-8",
                },
            },
        },
    });

    return sesClient.send(command);
}
