const User = require('../models/User');
const Admin = require('../models/Admin');
const {
    generateSecureOtp,
    generateResetToken,
    validatePasswordStrength
} = require('../utils/cryptoUtils');
const {
    sendOtpNotification,
    sendPasswordChangedNotification
} = require('../services/notificationService');

/**
 * Validate and sanitize registered mobile number.
 * Enforces registered mobile number ONLY (email is not accepted).
 * Accepts standard 10-digit mobile number, or with optional +91 / 0 prefix.
 * Returns { type: 'mobile', clean: string } or null if invalid.
 */
function parseIdentifier(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();

    // Reject emails or alphabetic characters
    if (trimmed.includes('@') || /[a-zA-Z]/.test(trimmed)) {
        return null;
    }

    // Clean whitespace, dashes, and parentheses
    const sanitized = trimmed.replace(/[\s\-()]/g, '');

    // Match 10-digit mobile number, with optional country code (+91, 91, 0)
    const mobileRegex = /^(\+?[0-9]{1,4})?[0-9]{10}$/;
    if (mobileRegex.test(sanitized)) {
        let clean = sanitized;
        // Normalize standard Indian country code prefixes to the 10-digit format
        if (clean.startsWith('+91') && clean.length === 13) {
            clean = clean.slice(3);
        } else if (clean.startsWith('91') && clean.length === 12) {
            clean = clean.slice(2);
        } else if (clean.startsWith('0') && clean.length === 11) {
            clean = clean.slice(1);
        }
        return { type: 'mobile', clean };
    }

    return null;
}

/**
 * Find an account (Admin, User, or Registration participant) by registered mobile number.
 * Checks in Admin, User, and Registration collections.
 */
async function findAccountByIdentifier(parsed) {
    const { clean } = parsed;
    const variations = [clean, `+91${clean}`, `91${clean}`, `0${clean}`];

    // 1. Search Admin by mobile or username
    let admin = await Admin.findOne({
        $or: [
            { mobile: { $in: variations } },
            { username: { $in: variations } }
        ]
    });
    if (admin) return { account: admin, userType: 'Admin' };

    // 2. Search User by mobile or username
    let user = await User.findOne({
        $or: [
            { mobile: { $in: variations } },
            { username: { $in: variations } }
        ]
    });
    if (user) return { account: user, userType: 'User' };

    // 3. Fallback: Search Registration collection for registered players or coaches
    try {
        const Registration = require('../models/Registration');
        const reg = await Registration.findOne({
            $or: [
                { 'players.mobileNo': { $in: variations } },
                { 'coaches.mobileNo': { $in: variations } }
            ]
        });

        if (reg) {
            const player = reg.players?.find(p => variations.includes(String(p.mobileNo).trim()));
            const coach = reg.coaches?.find(c => variations.includes(String(c.mobileNo).trim()));
            const person = player || coach;
            const pType = player ? 'player' : 'coach';

            // Check if User record exists, otherwise create it for this registered participant
            let linkedUser = await User.findOne({
                $or: [
                    { mobile: { $in: variations } },
                    { username: { $in: variations } }
                ]
            });

            if (!linkedUser) {
                linkedUser = await User.create({
                    username: clean,
                    name: person.playerName || person.name || 'Participant',
                    password: 'TemporaryPassword@123',
                    mobile: clean,
                    role: pType,
                    registrationId: reg._id,
                    participantId: person._id,
                    participantType: pType
                });
            }

            return { account: linkedUser, userType: 'User' };
        }
    } catch (regErr) {
        // If Registration model lookup fails, continue
    }

    return null;
}

/**
 * Endpoint: POST /api/auth/forgot-password
 * 1. Checks if mobile number exists in database. If not, returns 404 "Mobile number not registered".
 * 2. If valid OTP exists within 5-minute validity window: sends the SAME OTP (does not regenerate).
 * 3. If OTP expired or not yet created: generates a NEW OTP and replaces the old OTP in user document.
 */
exports.forgotPassword = async (req, res) => {
    const rawIdentifier = req.body.identifier || req.body.mobileNumber || req.body.mobile || req.body.emailOrMobile;
    const parsed = parseIdentifier(rawIdentifier);

    if (!parsed) {
        return res.status(400).json({
            message: 'Please provide a valid 10-digit registered mobile number.'
        });
    }

    try {
        const found = await findAccountByIdentifier(parsed);

        if (!found) {
            return res.status(404).json({
                message: 'Mobile number not registered. Please enter your registered mobile number.'
            });
        }

        const { account } = found;
        const now = new Date();

        // Check if an unverified OTP already exists within its 5-minute validity window
        const hasActiveOtp = account.resetOtp &&
                             account.resetOtp.otp &&
                             account.resetOtp.expiresAt &&
                             new Date(account.resetOtp.expiresAt) > now &&
                             !account.resetOtp.verifiedAt;

        if (hasActiveOtp) {
            // Check 60-second cooldown
            if (account.resetOtp.lastSentAt) {
                const elapsed = Date.now() - new Date(account.resetOtp.lastSentAt).getTime();
                if (elapsed < 60 * 1000) {
                    const remainingSecs = Math.ceil((60 * 1000 - elapsed) / 1000);
                    return res.status(429).json({
                        message: `Please wait ${remainingSecs} second${remainingSecs > 1 ? 's' : ''} before requesting another OTP.`
                    });
                }
            }

            // Check maximum 3 resends per window
            if ((account.resetOtp.resendCount || 0) >= 3) {
                return res.status(429).json({
                    message: 'Maximum OTP resend limit reached. Please wait for the current code to expire before requesting a new one.'
                });
            }

            // Re-send the SAME OTP within the 5-minute window!
            const sameOtp = account.resetOtp.otp;
            account.resetOtp.resendCount = (account.resetOtp.resendCount || 0) + 1;
            account.resetOtp.lastSentAt = new Date();
            await account.save();

            const remainingMinutes = Math.max(1, Math.ceil((new Date(account.resetOtp.expiresAt) - now) / 60000));
            const accountName = account.name || account.username || 'User';
            await sendOtpNotification({
                recipient: parsed.clean,
                recipientType: 'mobile',
                otp: sameOtp,
                validityMinutes: remainingMinutes,
                name: accountName
            });

            return res.status(200).json({
                message: 'OTP sent successfully to your registered mobile number.',
                mobile: parsed.clean
            });
        } else {
            // Previous OTP expired or no OTP exists: Generate a NEW 6-digit OTP and REPLACE the old OTP in user doc!
            const newOtp = generateSecureOtp();
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

            account.resetOtp = {
                otp: newOtp,
                expiresAt: expiresAt,
                attempts: 0,
                resendCount: 0,
                lastSentAt: new Date(),
                verifiedAt: null,
                resetToken: null,
                resetTokenExpiresAt: null
            };
            await account.save();

            const accountName = account.name || account.username || 'User';
            await sendOtpNotification({
                recipient: parsed.clean,
                recipientType: 'mobile',
                otp: newOtp,
                validityMinutes: 5,
                name: accountName
            });

            return res.status(200).json({
                message: 'OTP sent successfully to your registered mobile number.',
                mobile: parsed.clean
            });
        }
    } catch (error) {
        console.error('Forgot password error:', error);
        return res.status(500).json({ message: 'Internal server error while processing request.' });
    }
};

/**
 * Endpoint: POST /api/auth/verify-reset-otp
 * Verifies submitted OTP against user's stored resetOtp.otp.
 * Enforces max 5 attempts, invalidates OTP and generates short-lived reset token on user document.
 */
exports.verifyResetOtp = async (req, res) => {
    const rawIdentifier = req.body.identifier || req.body.mobileNumber || req.body.mobile || req.body.emailOrMobile;
    const otp = req.body.otp ? String(req.body.otp).trim() : '';

    const parsed = parseIdentifier(rawIdentifier);
    if (!parsed) {
        return res.status(400).json({ message: 'Valid registered mobile number is required.' });
    }

    if (!otp || !/^\d{6}$/.test(otp)) {
        return res.status(400).json({ message: 'OTP must be a valid 6-digit numeric code.' });
    }

    try {
        const found = await findAccountByIdentifier(parsed);
        if (!found) {
            return res.status(404).json({ message: 'Mobile number not registered.' });
        }

        const { account } = found;

        if (!account.resetOtp || !account.resetOtp.otp) {
            return res.status(400).json({
                message: 'No active password reset request found. Please request an OTP.'
            });
        }

        // Check if already verified
        if (account.resetOtp.verifiedAt) {
            return res.status(400).json({
                message: 'OTP has already been verified. Please proceed with setting your new password.'
            });
        }

        // Check if OTP has expired (5-minute limit)
        if (new Date() > new Date(account.resetOtp.expiresAt)) {
            return res.status(400).json({
                message: 'OTP has expired. Please request a new OTP.'
            });
        }

        // Check max 5 attempts limit
        if ((account.resetOtp.attempts || 0) >= 5) {
            return res.status(429).json({
                message: 'Maximum OTP verification attempts exceeded (5). Please request a new OTP.'
            });
        }

        // Increment attempts count
        account.resetOtp.attempts = (account.resetOtp.attempts || 0) + 1;

        // Verify OTP directly against stored code
        const isMatch = (account.resetOtp.otp === otp);

        if (!isMatch) {
            const remaining = Math.max(0, 5 - account.resetOtp.attempts);
            await account.save();

            if (remaining === 0) {
                return res.status(400).json({
                    message: 'Incorrect OTP. Maximum attempts exceeded. Please request a new OTP.'
                });
            }
            return res.status(400).json({
                message: `Incorrect OTP. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`
            });
        }

        // OTP is correct: generate cryptographically random reset token
        const rawResetToken = generateResetToken();
        const resetTokenExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        account.resetOtp.verifiedAt = new Date();
        account.resetOtp.resetToken = rawResetToken;
        account.resetOtp.resetTokenExpiresAt = resetTokenExpiresAt;
        await account.save();

        return res.status(200).json({
            message: 'OTP verified successfully.',
            resetToken: rawResetToken
        });
    } catch (error) {
        console.error('Verify reset OTP error:', error);
        return res.status(500).json({ message: 'Internal server error during OTP verification.' });
    }
};

/**
 * Endpoint: POST /api/auth/reset-password
 * Accepts reset token, new password, confirm password.
 * Updates user password in User/Admin collection and cleans up resetOtp details.
 */
exports.resetPassword = async (req, res) => {
    const { resetToken, newPassword, confirmPassword } = req.body;

    if (!resetToken || typeof resetToken !== 'string') {
        return res.status(400).json({ message: 'Reset token is required.' });
    }

    if (!newPassword || !confirmPassword) {
        return res.status(400).json({ message: 'New password and confirm password are required.' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ message: 'New password and confirm password do not match.' });
    }

    // Backend password strength validation (minimum 12 characters, uppercase, lowercase, number, symbol)
    const strengthResult = validatePasswordStrength(newPassword);
    if (!strengthResult.valid) {
        return res.status(400).json({
            message: strengthResult.errors.join('. ')
        });
    }

    try {
        // Find user or admin by reset token
        let account = await Admin.findOne({
            'resetOtp.resetToken': resetToken
        });

        if (!account) {
            account = await User.findOne({
                'resetOtp.resetToken': resetToken
            });
        }

        if (!account || !account.resetOtp) {
            return res.status(400).json({
                message: 'Invalid or unrecognized reset token. Please request a new password reset.'
            });
        }

        // Check if token has expired (5-minute limit)
        if (new Date() > new Date(account.resetOtp.resetTokenExpiresAt)) {
            return res.status(400).json({
                message: 'Reset token has expired (5-minute limit). Please request a new password reset.'
            });
        }

        const notifyMobile = account.mobile || account.username;

        // Set new password (bcrypt pre-save hook will hash it with 10 salt rounds)
        account.password = newPassword;

        // Invalidate and clear resetOtp details from user document
        account.resetOtp = null;
        await account.save();

        // Dispatch password changed security alert notification via SMS
        if (notifyMobile) {
            sendPasswordChangedNotification({
                recipient: notifyMobile,
                recipientType: 'mobile'
            }).catch(err => {
                console.error('Failed to dispatch password changed notification:', err);
            });
        }

        return res.status(200).json({
            message: 'Password has been reset successfully. You can now login with your new password.'
        });
    } catch (error) {
        console.error('Reset password error:', error);
        return res.status(500).json({ message: 'Internal server error during password reset.' });
    }
};

/**
 * Endpoint: POST /api/auth/resend-reset-otp
 * Resends the SAME OTP if within 5-minute window (after 60s cooldown).
 * If expired, generates a NEW OTP and replaces the old one.
 */
exports.resendResetOtp = async (req, res) => {
    return exports.forgotPassword(req, res);
};
