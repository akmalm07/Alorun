import Companion from "../src/mobile/Companion";
import { AuthGate } from "../src/mobile/auth";
export default function Screen() {
  return (
    <AuthGate>
      <Companion />
    </AuthGate>
  );
}
