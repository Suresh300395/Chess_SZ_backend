const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env') });

const {
    generateSecureOtp,
    generateResetToken,
    validatePasswordStrength
} = require('../utils/cryptoUtils');

const User = require('../models/User');
const Admin = require('../models/Admin');
const passwordResetController = require('../controllers/passwordResetController');

function createMockReqRes(body = {}, headers = {}) {
    const req = { body, headers };
    let statusCode = 200;
    let jsonResponse = null;

    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(data) {
            jsonResponse = data;
            return this;
        },
        getStatusCode: () => statusCode,
        getBody: () => jsonResponse
    };

    return { req, res };
}

describe('User Collection Embedded Password Reset OTP Test Suite (OTP Only, No Hash)', () => {
    let userStore = [];
    let adminStore = [];

    const testUserMobile = '9876543210';
    let currentTestUserPassword = 'InitialUserPass@123';
    const testUserId = '654321654321654321654321';

    before(() => {
        process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test_otp_secret_key_1234567890';
        process.env.LOG_OTP_FOR_DEV = 'false';

        // Mock User Document with embedded resetOtp (otp only, no otpHash)
        userStore = [{
            _id: testUserId,
            username: testUserMobile,
            mobile: testUserMobile,
            password: bcrypt.hashSync(currentTestUserPassword, 10),
            role: 'player',
            resetOtp: null,
            async comparePassword(candidate) {
                return bcrypt.compare(candidate, this.password);
            },
            async save() {
                if (this.password && !this.password.startsWith('$2')) {
                    this.password = await bcrypt.hash(this.password, 10);
                }
                return this;
            }
        }];

        adminStore = [];

        User.findOne = async (filter) => {
            return userStore.find(u => {
                if (filter.$or) {
                    return filter.$or.some(c => {
                        if (c.mobile) {
                            if (c.mobile.$in) return c.mobile.$in.includes(u.mobile);
                            return u.mobile === c.mobile;
                        }
                        if (c.username) {
                            if (c.username.$in) return c.username.$in.includes(u.username);
                            return u.username === c.username;
                        }
                        if (c['resetOtp.resetToken']) {
                            return u.resetOtp && u.resetOtp.resetToken === c['resetOtp.resetToken'];
                        }
                        return false;
                    });
                }
                if (filter.mobile) return u.mobile === filter.mobile;
                if (filter.username) return u.username === filter.username;
                if (filter['resetOtp.resetToken']) return u.resetOtp && u.resetOtp.resetToken === filter['resetOtp.resetToken'];
                return false;
            }) || null;
        };

        Admin.findOne = async () => null;

        try {
            const Registration = require('../models/Registration');
            Registration.findOne = async () => null;
        } catch (e) {}
    });

    describe('Crypto Utility & Security Primitives', () => {
        test('Generates cryptographically secure 6-digit numeric OTP', () => {
            for (let i = 0; i < 50; i++) {
                const otp = generateSecureOtp();
                assert.equal(typeof otp, 'string');
                assert.equal(otp.length, 6);
                assert.match(otp, /^\d{6}$/);
                const num = parseInt(otp, 10);
                assert.ok(num >= 100000 && num <= 999999);
            }
        });

        test('Reset token generation', () => {
            const token = generateResetToken();
            assert.equal(typeof token, 'string');
            assert.equal(token.length, 64);
        });

        test('Password strength validation rules (12+ chars, upper, lower, number, symbol)', () => {
            assert.equal(validatePasswordStrength('Short1@').valid, false);
            assert.equal(validatePasswordStrength('SuperStrongPassword@2026!').valid, true);
        });
    });

    describe('User Collection Embedded OTP Workflow Scenarios', () => {
        let firstGeneratedOtp = null;
        let activeResetToken = null;

        test('1. Valid registered mobile number stores OTP directly in User document (no otpHash)', async () => {
            userStore[0].resetOtp = null;
            const { req, res } = createMockReqRes({ identifier: testUserMobile });
            await passwordResetController.forgotPassword(req, res);

            assert.equal(res.getStatusCode(), 200);
            assert.match(res.getBody().message, /OTP sent successfully/i);

            const user = userStore[0];
            assert.ok(user.resetOtp, 'resetOtp must exist directly on user document');
            assert.equal(typeof user.resetOtp.otp, 'string');
            assert.equal(user.resetOtp.otp.length, 6);
            assert.equal(user.resetOtp.otpHash, undefined, 'otpHash must not be saved');
            assert.ok(user.resetOtp.expiresAt > new Date());
            assert.equal(user.resetOtp.attempts, 0);

            firstGeneratedOtp = user.resetOtp.otp;
        });

        test('2. Unregistered mobile number returns 404 "Mobile number not registered"', async () => {
            const { req, res } = createMockReqRes({ identifier: '9999999999' });
            await passwordResetController.forgotPassword(req, res);

            assert.equal(res.getStatusCode(), 404);
            assert.match(res.getBody().message, /mobile number not registered/i);
        });

        test('3. Within 5-minute validity window: Re-sending sends the SAME OTP (not newly generated)', async () => {
            // Fast-forward lastSentAt past 60s cooldown, still inside 5-min window
            userStore[0].resetOtp.lastSentAt = new Date(Date.now() - 70 * 1000);

            const { req, res } = createMockReqRes({ identifier: testUserMobile });
            await passwordResetController.forgotPassword(req, res);

            assert.equal(res.getStatusCode(), 200);

            const user = userStore[0];
            assert.equal(user.resetOtp.otp, firstGeneratedOtp, 'Must re-send the exact SAME OTP within the 5-min validity window');
            assert.equal(user.resetOtp.resendCount, 1);
        });

        test('4. Cooldown enforcement: Resending before 60 seconds returns 429', async () => {
            userStore[0].resetOtp.lastSentAt = new Date(Date.now() - 10 * 1000);

            const { req, res } = createMockReqRes({ identifier: testUserMobile });
            await passwordResetController.forgotPassword(req, res);

            assert.equal(res.getStatusCode(), 429);
            assert.match(res.getBody().message, /please wait/i);
        });

        test('5. After 5-minute validity window: Triggering generates a NEW OTP and REPLACES old OTP in DB', async () => {
            const oldOtp = userStore[0].resetOtp.otp;

            // Simulate expired OTP
            userStore[0].resetOtp.expiresAt = new Date(Date.now() - 1000);
            userStore[0].resetOtp.lastSentAt = new Date(Date.now() - 6 * 60 * 1000);

            const { req, res } = createMockReqRes({ identifier: testUserMobile });
            await passwordResetController.forgotPassword(req, res);

            assert.equal(res.getStatusCode(), 200);

            const user = userStore[0];
            assert.notEqual(user.resetOtp.otp, oldOtp, 'A new OTP must replace the expired old OTP');
            assert.equal(user.resetOtp.attempts, 0);
            assert.ok(user.resetOtp.expiresAt > new Date());

            firstGeneratedOtp = user.resetOtp.otp;
        });

        test('6. Incorrect OTP increments attempt counter in user doc', async () => {
            const { req, res } = createMockReqRes({
                identifier: testUserMobile,
                otp: '000000'
            });
            await passwordResetController.verifyResetOtp(req, res);

            assert.equal(res.getStatusCode(), 400);
            assert.match(res.getBody().message, /incorrect otp/i);
            assert.equal(userStore[0].resetOtp.attempts, 1);
        });

        test('7. Correct OTP verifies, generates resetToken on user document', async () => {
            const { req, res } = createMockReqRes({
                identifier: testUserMobile,
                otp: firstGeneratedOtp
            });
            await passwordResetController.verifyResetOtp(req, res);

            assert.equal(res.getStatusCode(), 200);
            assert.ok(res.getBody().resetToken);
            activeResetToken = res.getBody().resetToken;

            const user = userStore[0];
            assert.ok(user.resetOtp.verifiedAt);
            assert.equal(user.resetOtp.resetToken, activeResetToken);
            assert.ok(user.resetOtp.resetTokenExpiresAt > new Date());
        });

        test('8. Re-verifying an already verified OTP fails', async () => {
            const { req, res } = createMockReqRes({
                identifier: testUserMobile,
                otp: firstGeneratedOtp
            });
            await passwordResetController.verifyResetOtp(req, res);

            assert.equal(res.getStatusCode(), 400);
            assert.match(res.getBody().message, /already been verified/i);
        });

        test('9. Password mismatch is rejected', async () => {
            const { req, res } = createMockReqRes({
                resetToken: activeResetToken,
                newPassword: 'BrandNewSecurePass@2026!',
                confirmPassword: 'DifferentPassword@2026!'
            });
            await passwordResetController.resetPassword(req, res);

            assert.equal(res.getStatusCode(), 400);
            assert.match(res.getBody().message, /do not match/i);
        });

        test('10. Weak password is rejected (<12 characters)', async () => {
            const { req, res } = createMockReqRes({
                resetToken: activeResetToken,
                newPassword: 'short',
                confirmPassword: 'short'
            });
            await passwordResetController.resetPassword(req, res);

            assert.equal(res.getStatusCode(), 400);
            assert.match(res.getBody().message, /at least 12 characters/i);
        });

        test('11. Successful password reset updates user password and clears resetOtp from user doc', async () => {
            const brandNewPass = 'BrandNewSuperSecurePassword@2026!';
            const { req, res } = createMockReqRes({
                resetToken: activeResetToken,
                newPassword: brandNewPass,
                confirmPassword: brandNewPass
            });
            await passwordResetController.resetPassword(req, res);

            assert.equal(res.getStatusCode(), 200);
            assert.match(res.getBody().message, /successfully/i);

            const user = userStore[0];
            const matchesNew = await user.comparePassword(brandNewPass);
            assert.equal(matchesNew, true);

            assert.equal(user.resetOtp, null, 'resetOtp must be cleared from user document after password reset');
        });

        test('12. Consumed reset token cannot be reused', async () => {
            const { req, res } = createMockReqRes({
                resetToken: activeResetToken,
                newPassword: 'AnotherPassword@2026#',
                confirmPassword: 'AnotherPassword@2026#'
            });
            await passwordResetController.resetPassword(req, res);

            assert.equal(res.getStatusCode(), 400);
            assert.match(res.getBody().message, /invalid or unrecognized reset token/i);
        });
    });
});
