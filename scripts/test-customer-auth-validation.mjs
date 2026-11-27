import assert from 'node:assert/strict';
import {
  normalizeCustomerPhone,
  validateOtpFormat,
  validateCustomerProfile,
} from '../server/customer-auth-validation.js';

const phoneCases = [
  ['09307897825', '+989307897825'],
  ['+989307897825', '+989307897825'],
  ['00989307897825', '+989307897825'],
  ['989307897825', '+989307897825'],
  [' ۰۹۳۰۷۸۹۷۸۲۵  ', '+989307897825'],
  ['٠٩٣٠٧٨٩٧٨٢٥', '+989307897825'],
];
for (const [input, expected] of phoneCases) {
  assert.deepEqual(normalizeCustomerPhone(input), {ok: true, value: expected});
}

for (const input of [
  null, undefined, 9307897825, {},
  '9307897825',
  '0930789782',
  '093078978250',
  '0930789782a',
  '0930 789 7825',
  '+989307897825x',
  '++989307897825',
  '0098-307897825',
  '0912345678',
  '+98(930)7897825',
]) {
  assert.deepEqual(normalizeCustomerPhone(input), {ok: false, code: 'invalid_phone'});
}

for (const input of ['123456', ' 123456 ', '۱۲۳۴۵۶', '١٢٣٤٥٦', '٠٠١٢٣٤']) {
  assert.deepEqual(validateOtpFormat(input), {
    ok: true,
    value: input.trim().replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))),
  });
}
assert.deepEqual(validateOtpFormat('012345'), {ok: true, value: '012345'});
assert.deepEqual(validateOtpFormat('٠١٢٣٤٥'), {ok: true, value: '012345'});
for (const input of [123456, null, {}, '12345', '1234567', '1234a6', '1234 6', '١٢٣٤٥', '۱۲۳۴۵۶۷']) {
  assert.deepEqual(validateOtpFormat(input), {ok: false, code: 'invalid_otp_format'});
}

const profile = {
  first_name: '  نام\u200cخانوادگی  ',
  last_name: '  خانوادگی  ',
  marketing: true,
};
const profileSnapshot = {...profile};
const emptyReferral = {
  discovery_channel: 'not_reported',
  same_referrer: false,
  site_referrer: {status: 'not_reported', kind: null, value: null},
  salon_referrer: {status: 'not_reported', kind: null, value: null},
};
assert.deepEqual(validateCustomerProfile(profile), {
  ok: true,
  value: {
    first_name: 'نام\u200cخانوادگی',
    last_name: 'خانوادگی',
    marketing: true,
    referral: emptyReferral,
  },
});
assert.deepEqual(profile, profileSnapshot);

assert.deepEqual(validateCustomerProfile({first_name: 'ا'.repeat(80), last_name: 'خ'.repeat(100)}), {
  ok: true,
  value: {first_name: 'ا'.repeat(80), last_name: 'خ'.repeat(100), marketing: false, referral: emptyReferral},
});
assert.deepEqual(validateCustomerProfile({first_name: '𠮷'.repeat(80), last_name: 'خ'.repeat(100)}).ok, true);

const referralDeclaration = {
  discovery_channel: 'personal_referral',
  same_referrer: true,
  site_referrer: {status: 'pending', kind: 'code', value: ' K-42 '},
  salon_referrer: {status: 'pending', kind: 'code', value: 'K-42'},
};
assert.deepEqual(validateCustomerProfile({
  first_name: 'نام',
  last_name: 'خانوادگی',
  referral: referralDeclaration,
}), {
  ok: true,
  value: {
    first_name: 'نام',
    last_name: 'خانوادگی',
    marketing: false,
    referral: {
      discovery_channel: 'personal_referral',
      same_referrer: true,
      site_referrer: {status: 'pending', kind: 'code', value: 'K-42'},
      salon_referrer: {status: 'pending', kind: 'code', value: 'K-42'},
    },
  },
});
assert.deepEqual(validateCustomerProfile({
  first_name: 'نام',
  last_name: 'خانوادگی',
  referral: {
    discovery_channel: 'unknown',
    same_referrer: false,
    site_referrer: {status: 'unknown'},
    salon_referrer: {status: 'none'},
  },
}).value.referral, {
  discovery_channel: 'unknown',
  same_referrer: false,
  site_referrer: {status: 'unknown', kind: null, value: null},
  salon_referrer: {status: 'none', kind: null, value: null},
});

for (const input of [
  null, [], 'profile', 1,
  {},
  {first_name: 'نا', last_name: 'خ'},
  {first_name: 'ا', last_name: 'خانوادگی'},
  {first_name: 'ا'.repeat(81), last_name: 'خانوادگی'},
  {first_name: 'نام', last_name: 'خ'.repeat(101)},
  {first_name: 'نام', last_name: 'خانوادگی', marketing: 'true'},
  {first_name: 'نام', last_name: 'خانوادگی', marketing: 1},
  {first_name: 'نام', last_name: 'خانوادگی', marketing: undefined},
  {first_name: 'نام', last_name: 'خانوادگی', marketing: null},
  {first_name: 'نام', last_name: 'خانوادگی', phone: '+989307897825'},
  {first_name: 'نام', last_name: 'خانوادگی', account_id: 'account'},
  {first_name: 'نام', last_name: 'خانوادگی', proof_token: 'proof'},
  {first_name: 'نام', last_name: 'خانوادگی', temp_token: 'token'},
  {first_name: 'نام', last_name: 'خانوادگی', session_token: 'token'},
  {first_name: 'نام\0', last_name: 'خانوادگی'},
  {first_name: 'نا\tم', last_name: 'خانوادگی'},
  {first_name: 'نام\n', last_name: 'خانوادگی'},
  {first_name: 'نام', last_name: 'خانوادگی\u2028'},
  {first_name: 'نام', last_name: 'خانوادگی', role: 'admin'},
  {first_name: 'نام', last_name: 'خانوادگی', referral: {discovery_channel: 'phone'}},
  {first_name: 'نام', last_name: 'خانوادگی', referral: {site_referrer: {status: 'confirmed'}}},
  {first_name: 'نام', last_name: 'خانوادگی', referral: {site_referrer: {status: 'pending', kind: 'name'}}},
  {first_name: 'نام', last_name: 'خانوادگی', referral: {site_referrer: {status: 'unknown', value: 'شخص'}}},
  {first_name: 'نام', last_name: 'خانوادگی', referral: {
    ...referralDeclaration,
    salon_referrer: {status: 'pending', kind: 'code', value: 'OTHER'},
  }},
  {first_name: 'نام', last_name: 'خانوادگی', referral: {...referralDeclaration, role: 'staff'}},
]) {
  assert.deepEqual(validateCustomerProfile(input), {ok: false, code: 'invalid_profile'});
}

assert.deepEqual(validateCustomerProfile({first_name: '  نام  ', last_name: '  محمدی  '}), {
  ok: true,
  value: {first_name: 'نام', last_name: 'محمدی', marketing: false, referral: emptyReferral},
});

const nonMutable = Object.freeze({first_name: 'نام', last_name: 'خانوادگی'});
assert.deepEqual(validateCustomerProfile({...nonMutable, marketing: false}), {
  ok: true,
  value: {...nonMutable, marketing: false, referral: emptyReferral},
});
assert.deepEqual(validateCustomerProfile(nonMutable), {
  ok: true,
  value: {first_name: 'نام', last_name: 'خانوادگی', marketing: false, referral: emptyReferral},
});

const envSnapshot = JSON.stringify(process.env);
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error('validation test must not make network requests');
};
try {
  assert.deepEqual(normalizeCustomerPhone('09307897825'), {ok: true, value: '+989307897825'});
  assert.deepEqual(validateOtpFormat('123456'), {ok: true, value: '123456'});
  assert.deepEqual(validateCustomerProfile({first_name: 'نام', last_name: 'خانوادگی'}).ok, true);
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(JSON.stringify(process.env), envSnapshot);

console.log('Customer auth validation passed: strict phone/OTP/profile input, Unicode limits, referral declaration states and no I/O side effects.');
