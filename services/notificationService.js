/**
 * Notification Service
 * Handles multi-channel delivery (Email / SMS) for OTPs and security alerts.
 * Configured dynamically through environment variables.
 * Safe for production: never logs OTP in production environment.
 */

const APP_NAME = process.env.APP_NAME || 'National Sports Championship Portal';
const smsController = require('../controllers/smsController');

/**
 * Generate HTML email template for Password Reset OTP.
 */
function generateOtpEmailTemplate(otp, validityMinutes = 5) {
    return {
        subject: `[${APP_NAME}] Your Password Reset Verification Code: ${otp}`,
        text: `Your password reset verification code for ${APP_NAME} is: ${otp}\n\nThis code will expire in ${validityMinutes} minutes.\n\nSECURITY NOTICE:\nDo not share this OTP with anyone, including support staff or administrators. If you did not request this code, please ignore this email or secure your account immediately.\n\n© ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.`,
        html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset OTP</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: 'Montserrat', Arial, sans-serif; color: #0D233B;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f9; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06); border: 1px solid #eaedf1;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0b5299 0%, #0D233B 100%); padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px;">${APP_NAME}</h1>
              <p style="color: #e2e8f0; margin: 8px 0 0; font-size: 13px;">Security & Account Authentication</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="font-size: 18px; font-weight: 600; color: #0D233B; margin: 0 0 16px;">Password Reset Verification</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px;">
                We received a request to reset your password. Use the verification code below to complete the process.
              </p>
              
              <!-- OTP Box -->
              <div style="background-color: #f8fafc; border: 2px dashed #0b5299; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
                <span style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 1.5px; display: block; margin-bottom: 8px;">Your 6-Digit One-Time Password</span>
                <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0b5299; font-family: 'Courier New', monospace; display: inline-block;">${otp}</span>
                <div style="margin-top: 10px; font-size: 12px; color: #d06c38; font-weight: 600;">
                  ⏳ Valid for ${validityMinutes} minutes only
                </div>
              </div>

              <!-- Warning Box -->
              <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 4px; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #92400e; font-weight: 500;">
                  <strong>Important Security Notice:</strong> Never share this code with anyone. Representatives from ${APP_NAME} will never ask for your OTP.
                </p>
              </div>

              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 0;">
                If you did not request this password reset, no action is needed. Your account remains secure.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #eaedf1;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                This is an automated security notification from ${APP_NAME}. Please do not reply directly to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
    };
}

/**
 * Generate notification for successful password change.
 */
function generatePasswordChangedTemplate() {
    return {
        subject: `[${APP_NAME}] Security Alert: Your Password Was Successfully Changed`,
        text: `Your password for ${APP_NAME} was successfully changed on ${new Date().toUTCString()}.\n\nIf you made this change, you can safely disregard this message.\n\nIF YOU DID NOT MAKE THIS CHANGE, please contact administration or support immediately to secure your account.`,
        html: `
<!DOCTYPE html>
<html lang="en">
<body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: Arial, sans-serif; color: #0D233B;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f9; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #eaedf1;">
          <tr>
            <td style="background-color: #0b5299; padding: 24px; text-align: center; color: #ffffff;">
              <h1 style="margin: 0; font-size: 20px;">${APP_NAME}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <h2 style="color: #10b981; font-size: 18px; margin: 0 0 16px;">✓ Password Reset Successful</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #475569;">
                The password for your account was successfully updated on <strong>${new Date().toUTCString()}</strong>.
              </p>
              <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; font-size: 13px; color: #991b1b;">
                  <strong>Did not initiate this change?</strong> Please contact support or the tournament admin immediately to lock your account.
                </p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
    };
}

/**
 * Send an email via configured transport or SMTP.
 */
async function sendEmail({ to, subject, html, text }) {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || `noreply@sports-tournament.org`;

    // 1. If nodemailer is available and SMTP credentials exist, use nodemailer
    let nodemailer = null;
    try {
        nodemailer = require('nodemailer');
    } catch (e) {
        // nodemailer not installed
    }

    if (nodemailer && smtpHost && smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass
            }
        });

        await transporter.sendMail({
            from: smtpFrom,
            to,
            subject,
            text,
            html
        });
        return { success: true, channel: 'smtp' };
    }

    // 2. HTTP-based email providers (e.g. Resend) if configured
    if (process.env.RESEND_API_KEY) {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: smtpFrom,
                to: [to],
                subject,
                html,
                text
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Resend email provider error: ${errBody}`);
        }
        return { success: true, channel: 'resend' };
    }

    // 3. Fallback for development / mock testing when no live SMTP provider is configured
    if (process.env.NODE_ENV !== 'production') {
        const isDevOtpLogEnabled = process.env.LOG_OTP_FOR_DEV === 'true';
        console.log(`[NotificationService] [DEV/TEST] Email dispatched to: ${to}`);
        console.log(`[NotificationService] [DEV/TEST] Subject: ${subject}`);
        if (isDevOtpLogEnabled) {
            console.log(`[NotificationService] [DEV/TEST] Text Preview: ${text.slice(0, 100)}...`);
        }
        return { success: true, channel: 'dev-mock' };
    }

    // In production without email provider configured
    console.warn(`[NotificationService] Production email provider is not configured. Email to ${to} could not be delivered.`);
    return { success: false, channel: 'none', error: 'Email provider not configured' };
}

/**
 * Send an SMS via configured provider (VISPL / Twilio / Fast2SMS / dev mock).
 */
async function sendSms({ to, message, otp, name }) {
    // 1. Primary: VISPL SMS Gateway API
    const visplUser = process.env.SMS_USERNAME;
    const visplPass = process.env.SMS_PASSWORD;
    if (visplUser && visplPass) {
        try {
            return await smsController.sendSms({ to, text: message, otp, name });
        } catch (visplErr) {
            console.error('[NotificationService] VISPL gateway delivery failed:', visplErr.message);
            // continue to fallbacks if configured
        }
    }

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_FROM_NUMBER;

    // 2. Twilio REST API
    if (twilioSid && twilioAuth && twilioFrom) {
        const auth = Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');
        const params = new URLSearchParams();
        params.append('To', to);
        params.append('From', twilioFrom);
        params.append('Body', message);

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Twilio SMS error: ${err}`);
        }
        return { success: true, channel: 'twilio' };
    }

    // 3. Fast2SMS API
    if (process.env.FAST2SMS_API_KEY) {
        const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
            method: 'POST',
            headers: {
                'authorization': process.env.FAST2SMS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                route: 'otp',
                variables_values: otp,
                numbers: to
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Fast2SMS error: ${err}`);
        }
        return { success: true, channel: 'fast2sms' };
    }

    // 4. Fallback for development / mock testing
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[NotificationService] [DEV/TEST] SMS dispatched to: ${to}`);
        if (process.env.LOG_OTP_FOR_DEV === 'true') {
            console.log(`[NotificationService] [DEV/TEST] Message: ${message}`);
        }
        return { success: true, channel: 'dev-mock' };
    }

    console.warn(`[NotificationService] Production SMS provider is not configured. SMS to ${to} could not be delivered.`);
    return { success: false, channel: 'none', error: 'SMS provider not configured' };
}

/**
 * Main dispatcher to send OTP to user via email or SMS.
 */
async function sendOtpNotification({ recipient, recipientType, otp, validityMinutes = 5, name = 'User' }) {
    if (recipientType === 'email') {
        const template = generateOtpEmailTemplate(otp, validityMinutes);
        return await sendEmail({
            to: recipient,
            subject: template.subject,
            text: template.text,
            html: template.html
        });
    } else {
        const message = smsController.formatOtpMessage(otp, name);
        return await sendSms({
            to: recipient,
            message,
            otp,
            name
        });
    }
}

/**
 * Main dispatcher to notify user of password change.
 */
async function sendPasswordChangedNotification({ recipient, recipientType }) {
    if (recipientType === 'email') {
        const template = generatePasswordChangedTemplate();
        return await sendEmail({
            to: recipient,
            subject: template.subject,
            text: template.text,
            html: template.html
        });
    } else {
        const message = `Your password for ${APP_NAME} was successfully updated. If you did not make this change, please contact administration immediately.`;
        return await sendSms({
            to: recipient,
            message
        });
    }
}

module.exports = {
    sendOtpNotification,
    sendPasswordChangedNotification,
    generateOtpEmailTemplate,
    generatePasswordChangedTemplate
};

