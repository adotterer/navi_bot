import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// SES can be in a different region than the app (e.g. Beanstalk in us-west-1, SES in us-east-1).
const sesRegion = process.env.SES_REGION || process.env.AWS_REGION || "us-east-1";
const sesClient = new SESClient({ region: sesRegion });






/**
 * Generates a mobile-responsive HTML template for the 2FA email.
 */
function getHtmlTemplate(code) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: -apple-system, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 20px auto; padding: 20px; text-align: center; border: 1px solid #eee; border-radius: 8px; }
        .code { font-family: monospace; font-size: 40px; font-weight: bold; background: #f9f9f9; padding: 20px; margin: 20px 0; display: inline-block; letter-spacing: 5px; color: #222; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Navi Admin</h2>
        <p>Your verification code is:</p>
        <div class="code">${code}</div>
        <p>It expires in 10 minutes.</p>
    </div>
</body>
</html>`;
}

/**
 * Sends a 2FA verification code to the specified email address using Amazon SES.
 * Requires SES_SENDER_EMAIL (verified in SES). Uses AWS SDK; no Lambda needed.
 */
export async function send2FACode(email, code) {
    const sender = process.env.SES_SENDER_EMAIL;
    if (!sender) {
        throw new Error("SES_SENDER_EMAIL environment variable is not set.");
    }

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
                Text: {
                    Data: `Your verification code is: ${code}\n\nIt expires in 10 minutes.`,
                    Charset: "UTF-8",
                },
                Html: {
                    Data: getHtmlTemplate(code),
                    Charset: "UTF-8",
                },
            },
        },
    });

    console.info(`[2FA] Sending code to ${email}. Rendered HTML: ${command.input.Message.Body.Html.Data}`);
    return sesClient.send(command);
}
