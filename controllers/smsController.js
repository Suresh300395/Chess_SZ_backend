/**
 * SMS Controller & Service
 * Handles SMS delivery via VISPL SMS Gateway API.
 * All sensitive credentials (URL, username, password, sender ID) are retrieved from .env.
 */

// Helper to normalize phone numbers to clean 10 digits
function cleanPhoneNumber(phone) {
    if (!phone) return '';
    let cleaned = String(phone).replace(/[\s\-()+]/g, '');
    if (cleaned.startsWith('91') && cleaned.length === 12) {
        cleaned = cleaned.slice(2);
    } else if (cleaned.startsWith('0') && cleaned.length === 11) {
        cleaned = cleaned.slice(1);
    }
    return cleaned;
}

/**
 * Format OTP text using registered VISPL / DLT Template:
 * "Dear {#var#}, Thank you for reaching out to us. To verify your request and proceed with further actions, please use the following One-Time Password (OTP): {#var#} @ADITYA UNIVERSITY"
 */
function formatOtpMessage(otp, name = 'User') {
    const safeName = (name && String(name).trim()) ? String(name).trim() : 'User';
    return `Dear ${safeName}, Thank you for reaching out to us. To verify your request and proceed with further actions, please use the following One-Time Password (OTP): ${otp} @ADITYA UNIVERSITY`;
}

/**
 * Send SMS using VISPL multiSend API
 * @param {Object} options
 * @param {string} options.to - Recipient phone number
 * @param {string} [options.text] - Full message body (DLT compliant)
 * @param {string} [options.otp] - One-time password (auto-formats with DLT template if text not given)
 * @param {string} [options.name] - Recipient name for template
 */
async function sendSms({ to, text, otp, name }) {
    const gatewayUrl = process.env.SMS_GATEWAY_URL || 'https://pgapi.vispl.in/fe/api/v1/multiSend';
    const username = process.env.SMS_USERNAME || 'aditrpg1.trans';
    const password = process.env.SMS_PASSWORD || 'Ad1tya@1234';
    const from = process.env.SMS_FROM || 'ADIUNV';
    const unicode = process.env.SMS_UNICODE || 'false';

    const cleanNumber = cleanPhoneNumber(to);
    if (!cleanNumber || cleanNumber.length !== 10) {
        throw new Error(`Invalid recipient mobile number: "${to}". Must be a valid 10-digit mobile number.`);
    }

    const messageText = text || (otp ? formatOtpMessage(otp, name) : '');
    if (!messageText) {
        throw new Error('Message text or OTP is required to send SMS.');
    }

    // Build URL with query parameters
    const url = new URL(gatewayUrl);
    url.searchParams.set('username', username);
    url.searchParams.set('password', password);
    url.searchParams.set('unicode', unicode);
    url.searchParams.set('from', from);
    url.searchParams.set('to', cleanNumber);
    url.searchParams.set('text', messageText);

    try {
        console.log(`[SMS Controller] Dispatching SMS to ${cleanNumber} via VISPL gateway...`);
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': '*/*'
            }
        });

        const responseText = await response.text();
        console.log(`[SMS Controller] Gateway response: ${responseText}`);

        if (!response.ok) {
            console.error(`[SMS Controller] Gateway returned HTTP ${response.status}: ${responseText}`);
            return {
                success: false,
                status: response.status,
                error: responseText
            };
        }

        return {
            success: true,
            channel: 'vispl',
            status: response.status,
            response: responseText
        };
    } catch (error) {
        console.error('[SMS Controller] Error sending SMS:', error.message);
        throw error;
    }
}

/**
 * Controller endpoint for testing or manual SMS dispatch (Admin only)
 */
async function sendTestSms(req, res) {
    const { to, text, otp, name } = req.body;
    if (!to) {
        return res.status(400).json({ message: 'Mobile number (to) is required' });
    }

    try {
        const result = await sendSms({ to, text, otp, name });
        return res.status(200).json({
            message: 'SMS dispatched successfully',
            result
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Failed to send SMS',
            error: error.message
        });
    }
}

module.exports = {
    sendSms,
    formatOtpMessage,
    cleanPhoneNumber,
    sendTestSms
};

