import Missions from "../src/mobile/Missions";
import { AuthGate } from "../src/mobile/auth";
export default function Screen() {
  return (
    <AuthGate>
      <Missions />
    </AuthGate>
  );
}
