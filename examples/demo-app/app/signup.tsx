import auth from "@react-native-firebase/auth";
import { GoogleSignin } from "@react-native-google-signin/google-signin";

export async function signUpWithEmail(email: string, password: string) {
  return auth().createUserWithEmailAndPassword(email, password);
}

export async function signUpWithGoogle() {
  const { idToken } = await GoogleSignin.signIn();
  return auth().signInWithCredential(auth.GoogleAuthProvider.credential(idToken));
}
