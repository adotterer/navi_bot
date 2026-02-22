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

    const htmlBody = `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; background-color: #f4f4f4; padding: 20px;">
    <div style="max-width: 400px; margin: auto; background: #ffffff; padding: 30px; border-radius: 10px; text-align: center; border: 1px solid #eeeeee;">
        <h2 style="color: #222; margin-bottom: 20px;">Navi Admin</h2>
        <p style="font-size: 16px; color: #444;">Your verification code is:</p>
        <div style="font-size: 36px; font-weight: bold; background: #000000; color: #ffffff; padding: 15px 25px; border-radius: 6px; display: inline-block; letter-spacing: 5px; margin: 20px 0; font-family: monospace;">
            ${code}
        </div>
        <p style="font-size: 14px; color: #777; margin-top: 20px;">It expires in 10 minutes.</p>
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
                    Data: `Your verification code is: ${code}\n\nIt expires in 10 minutes.`,
                    Charset: "UTF-8",
                },
                Html: {
                    Data: `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:16px;">
<p>Your Navi Admin verification code is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:0.2em;">${code}</p>
<p style="color:#666;">It expires in 10 minutes.</p>
</body></html>`,
                    Charset: "UTF-8",
                },
            },
        },
    });

    return sesClient.send(command);
}
