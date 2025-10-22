// app/scan.tsx
// PURPOSE:
// - Placeholder for future camera scan.
// - For now: a button that "pretends" to detect items and stores them in the pantry.
//
// HOW IT WORKS NOW:
// - Pressing the button calls addItems(["eggs","milk","spinach"]).
// - We also display the current pantry contents below.

import { View, Text, Button } from "react-native";
// NOTE: use a RELATIVE path (../) because we did NOT configure path aliases yet.
import usePantry, { PantryState } from "../store/usePantry";

export default function Scan() {
  // Pull specific pieces from the store with type-safe selectors
  const addItems = usePantry((s: PantryState) => s.addItems);
  const items    = usePantry((s: PantryState) => s.items);

  return (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "700" }}>Scan</Text>
      <Text style={{ marginTop: 8, color: "#555" }}>
        (demo) tap the button to add fake items
      </Text>

      {/* Simulate a successful scan */}
      <View style={{ marginTop: 16 }}>
        <Button
          title="Mock detect (eggs, milk, spinach)"
          onPress={() => addItems(["eggs", "milk", "spinach"])}
        />
      </View>

      {/* Show the current pantry contents */}
      <Text style={{ marginTop: 24, fontWeight: "600" }}>Current pantry:</Text>
      <Text style={{ marginTop: 8, color: "#333" }}>
        {items.length ? items.join(", ") : "— empty —"}
      </Text>
    </View>
  );
}
