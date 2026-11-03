const crypto = require('crypto');

/**
 * Returns the secret used for HMAC-SHA256 hashing of OTPs and reset tokens.
 * Falls back to JWT_SECRET if OTP_HMAC_SECRET is not explicitly defined.
 */
function getOtpHmacSecret() {
    const secret = process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('FATAL: Neither OTP_HMAC_SECRET nor JWT_SECRET environment variable is configured.');
    }
    return secret;
}

/**
 * Cryptographically secure 6-digit OTP generation using crypto.randomInt.
 * Guarantees a 6-digit string between "100000" and "999999".
 * NEVER uses Math.random().
 */
function generateSecureOtp() {
    return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hash an OTP using HMAC-SHA256.
 * @param {string} otp 
 * @param {string} [secret]
 * @returns {string} hex-encoded HMAC
 */
function hashOtp(otp, secret = getOtpHmacSecret()) {
    if (!otp) return '';
    return crypto.createHmac('sha256', secret).update(String(otp)).digest('hex');
}

/**
 * Securely verify a candidate OTP against a stored HMAC-SHA256 hash using timingSafeEqual
 * to prevent timing attacks.
 * @param {string} candidateOtp 
 * @param {string} storedOtpHash 
 * @param {string} [secret]
 * @returns {boolean}
 */
function verifyOtpHash(candidateOtp, storedOtpHash, secret = getOtpHmacSecret()) {
    if (!candidateOtp || !storedOtpHash) return false;
    const candidateHash = hashOtp(candidateOtp, secret);
    const candidateBuffer = Buffer.from(candidateHash, 'hex');
    const storedBuffer = Buffer.from(storedOtpHash, 'hex');

    if (candidateBuffer.length !== storedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
}

/**
 * Generate a cryptographically random, 256-bit (64 hex characters) password reset token.
 * @returns {string}
 */
function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a reset token using HMAC-SHA256.
 * @param {string} token 
 * @param {string} [secret]
 * @returns {string} hex-encoded HMAC
 */
function hashResetToken(token, secret = getOtpHmacSecret()) {
    if (!token) return '';
    return crypto.createHmac('sha256', secret).update(String(token)).digest('hex');
}

/**
 * Securely verify a reset token against a stored hash using timingSafeEqual.
 * @param {string} candidateToken 
 * @param {string} storedHash 
 * @param {string} [secret]
 * @returns {boolean}
 */
function verifyResetTokenHash(candidateToken, storedHash, secret = getOtpHmacSecret()) {
    if (!candidateToken || !storedHash) return false;
    const candidateHash = hashResetToken(candidateToken, secret);
    const candidateBuffer = Buffer.from(candidateHash, 'hex');
    const storedBuffer = Buffer.from(storedHash, 'hex');

    if (candidateBuffer.length !== storedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
}

/**
 * Backend password strength validation.
 * Enforces:
 * - Minimum 12 characters length
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one digit (0-9)
 * - At least one special character
 * 
 * @param {string} password 
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePasswordStrength(password) {
    const errors = [];
    if (!password || typeof password !== 'string') {
        return { valid: false, errors: ['Password is required and must be a string'] };
    }

    if (password.length < 12) {
        errors.push('Password must be at least 12 characters long');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one numeric digit');
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        errors.push('Password must contain at least one special character (e.g. !@#$%^&*)');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    getOtpHmacSecret,
    generateSecureOtp,
    hashOtp,
    verifyOtpHash,
    generateResetToken,
    hashResetToken,
    verifyResetTokenHash,
    validatePasswordStrength
};

