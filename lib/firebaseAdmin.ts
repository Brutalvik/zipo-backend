import admin from "firebase-admin";

let app: admin.app.App;

export function getAdminApp(): admin.app.App {
  if (app) return app;

  const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (svcJson) {
    app = admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(svcJson)),
    });
  } else {
    app = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }

  return app;
}

export async function verifyIdToken(
  idToken: string
): Promise<admin.auth.DecodedIdToken> {
  const adminApp = getAdminApp();
  console.log("Verifying token...");
  const decoded = await adminApp.auth().verifyIdToken(idToken);
  return decoded;
}
