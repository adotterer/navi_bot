# Amazon SES setup for admin 2FA (subdomain)

Admin 2FA sends a 6-digit code by email using **Amazon SES** and the **AWS SDK** (`@aws-sdk/client-ses`) from this app. No Lambda is required.

## 1. AWS Console – SES

### Region

SES is regional. The app uses **SES_REGION** if set, otherwise **AWS_REGION**, otherwise `us-east-1`. If your app runs in one region (e.g. Beanstalk in `us-west-1`) and SES is in another (e.g. `us-east-1`), set **SES_REGION=us-east-1** in the environment so the SES client calls the correct region.

### Verify the subdomain (or reuse main domain)

You already have SES set up for your main domain. For a **subdomain** you can either:

- **Option A – Verify the subdomain in SES**  
  1. In [SES → Verified identities](https://console.aws.amazon.com/ses/home#/verified-identities), click **Create identity**.  
  2. Choose **Domain**.  
  3. Enter the subdomain, e.g. `admin.yourproject.com` or the exact domain you use for this app.  
  4. If you use a **root domain** (e.g. `yourproject.com`) and want to send from a subdomain address like `no-reply@admin.yourproject.com`, verify the **root domain** and add the DKIM CNAMEs for that domain (SES will show them). Subdomain addresses are often covered by the root domain verification; if not, create a separate identity for the subdomain.  
  5. Add the DNS records (CNAME for DKIM) in your DNS provider.  
  6. Wait until SES shows the identity as **Verified**.

- **Option B – Reuse the main domain**  
  If your main domain (e.g. `matthewshippoboe.com`) is already verified, you can send from an address on that domain (e.g. `no-reply@matthewshippoboe.com`) or from a subdomain address if your DNS/DKIM is set up for it. No need to verify the subdomain separately unless you want the “From” address to be on the subdomain (e.g. `no-reply@subdomain.main.com`).

### Sender address

- Choose a **From** address that uses a verified identity (domain or email), e.g. `no-reply@your-subdomain.example.com` or `no-reply@matthewshippoboe.com`.  
- Set this in your app as **SES_SENDER_EMAIL** (see below).

### Leave sandbox (production only)

- In **SES → Account dashboard**, if your account is still in **Sandbox**, you can only send to verified addresses.  
- To send to any inbox (e.g. your Gmail for 2FA), request **Production access** in the SES console (or via support).  
- Until then, add the recipient address (e.g. `your@gmail.com`) as a **Verified identity** (type: Email) so you can receive the 2FA code in sandbox.

### IAM permissions for the app

The process that runs this app (e.g. EC2, ECS, or your local machine) needs credentials that can call SES. Attach a policy that allows `ses:SendEmail` (and optionally `ses:SendRawEmail`) for the verified identity (or `*`).

Example policy (restrict `Resource` to your identity ARN if you prefer):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    }
  ]
}
```

Use IAM user access keys, or an IAM role (EC2/ECS/Lambda role) and **do not** put keys in code. Set **AWS_ACCESS_KEY_ID**, **AWS_SECRET_ACCESS_KEY**, and **AWS_REGION** in the environment (or rely on the role in AWS).

## 2. App configuration (no Lambda)

The app uses the AWS SDK in Node:

- **Package:** `@aws-sdk/client-ses`  
- **Code:** `src/shared/sesHelper.js` – `send2FACode(email, code)`  
- **Auth flow:** `src/admin/auth.js` (2FA helpers) and `src/admin/routes.js` (login → send code → verify code)

Environment variables:

| Variable            | Required | Description |
|---------------------|----------|-------------|
| `SES_SENDER_EMAIL`  | For 2FA  | Verified “From” address in SES (e.g. `no-reply@your-subdomain.example.com`). |
| `ADMIN_EMAIL`       | For 2FA  | Email that receives the 2FA code (e.g. your Gmail). |
| `SES_REGION`        | Optional | Region where SES is (e.g. `us-east-1`). Use when SES is in a different region than the app (e.g. Beanstalk in us-west-1). Defaults to `AWS_REGION` or `us-east-1`. |
| `AWS_REGION`        | Optional | Default AWS region for the app (S3, etc.). SES uses `SES_REGION` if set, else this, else `us-east-1`. |
| `AWS_ACCESS_KEY_ID` | In AWS   | Not needed if the app runs with an IAM role. |
| `AWS_SECRET_ACCESS_KEY` | In AWS | Not needed if the app runs with an IAM role. |

If **both** `SES_SENDER_EMAIL` and `ADMIN_EMAIL` are set, the admin login flow will:

1. Check password.  
2. Generate a 6-digit code, store it in the session (10-minute expiry).  
3. Call `send2FACode(ADMIN_EMAIL, code)` (SES via SDK).  
4. Redirect to `/admin/2fa` to enter the code.  
5. On success, set the admin session and redirect to `/admin`.

If either variable is missing, login stays password-only (no 2FA).

## 3. Summary

- **SES:** Verify the domain (or subdomain) you send from; leave sandbox for production; add IAM permissions for `ses:SendEmail`.  
- **App:** Set `SES_SENDER_EMAIL` and `ADMIN_EMAIL` (and AWS credentials/region if not using a role).  
- **No Lambda:** Sending is done in-process with `@aws-sdk/client-ses`.
