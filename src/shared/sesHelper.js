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
            },
        },
    });

    return sesClient.send(command);
}
