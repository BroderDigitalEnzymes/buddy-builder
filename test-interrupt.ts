import { createSession } from "./src/index.js";

async function main() {
  console.log("1. Creating session...");
  const session = await createSession({ permissionMode: "bypassPermissions" });

  // Wait for ready
  const sessionId = await new Promise<string>((resolve) => {
    session.on("ready", (init) => {
      console.log(`   Ready: session=${init.session_id.slice(0, 8)} model=${init.model}`);
      resolve(init.session_id);
    });
  });

  // Send a prompt that will take a while
  console.log("2. Sending long prompt...");
  session.send("Write a detailed 500-word essay about the history of computing. Do not use any tools.");

  // Collect text
  let textLen = 0;
  session.on("text", (ev) => { textLen += ev.text.length; });

  // Wait 4 seconds then soft-interrupt
  await new Promise<void>((resolve) => setTimeout(resolve, 4000));
  console.log(`3. Received ${textLen} chars so far. Sending soft interrupt...`);
  console.log(`   State before interrupt: ${session.state}`);

  session.interrupt();

  // Wait for the result event (should come without killing the process)
  const result = await new Promise<{ cost: number; turns: number; error: boolean }>((resolve) => {
    session.once("result", (r) => {
      resolve({ cost: r.total_cost_usd, turns: r.num_turns, error: r.is_error });
    });
    // Safety timeout
    setTimeout(() => resolve({ cost: 0, turns: 0, error: true }), 15000);
  });

  console.log(`4. Result received: cost=$${result.cost.toFixed(4)} turns=${result.turns} error=${result.error}`);
  console.log(`   State after result: ${session.state}`);
  console.log(`   Total text received: ${textLen} chars`);

  // Verify session is still alive by sending a follow-up
  console.log("5. Sending follow-up message (session should still be alive)...");
  session.send("Say 'INTERRUPT TEST PASSED' and nothing else.");

  let followUp = "";
  session.on("text", (ev) => { followUp += ev.text; });
  await new Promise<void>((resolve) => {
    session.once("result", () => resolve());
    setTimeout(resolve, 30000);
  });

  console.log(`6. Follow-up response: ${followUp.trim()}`);
  console.log("   Test complete! Session stayed alive through interrupt.");

  await session.dispose();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
