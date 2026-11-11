$ErrorActionPreference='Stop'
& node --test playwright-worker/src/attach-target-policy.test.js
if($LASTEXITCODE -ne 0){throw 'ATTACH_TARGET_POLICY_TEST_FAILED'}
