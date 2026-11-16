import Today from "../src/mobile/Today";
import { AuthGate } from "../src/mobile/auth";
export default function Screen() {
  return (
    <AuthGate>
      <Today />
    </AuthGate>
  );
}
