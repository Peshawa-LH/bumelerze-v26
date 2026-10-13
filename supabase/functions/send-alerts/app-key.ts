// The PUBLIC web push (VAPID) key the app's web build subscribes with. Public
// by design: it ships inside every app bundle (EXPO_PUBLIC_VAPID_PUBLIC_KEY in
// scripts/build-app-web.sh). This is the one copy the send-alerts function
// compares its secrets with (vapid-check.ts); a test fails if the build
// script or the Netlify mirror carry a different key. Rotating the key pair =
// change it here, in those two files, and in the function's secrets together.
export const APP_VAPID_PUBLIC_KEY =
  "BMC0pPjw9ICMY-_R7zlWMDlqoB6XhQRsPbFNFrST55eFGtVmR3LoM4nxFN9HHH5mK4yOUdrXbFa3vLiodH_0mrw";
