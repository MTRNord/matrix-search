import { MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider, RustSdkCryptoStoreType } from "matrix-bot-sdk";
import Indexer from "./indexer.js";
import Config from "./config.js";
import { GetRoomMessagesRequest, GetRoomMessagesResponse, Received, RoomEventFilter, Event } from "./matrix.js";
import fs from "node:fs";

const directions = { forward: "f", reverse: "b" } as const;
// Pending https://github.com/turt2live/matrix-bot-sdk/issues/250
async function* getRoomEvents(
    client: MatrixClient,
    room: string,
    direction: "forward" | "reverse",
    filter?: RoomEventFilter
): AsyncGenerator<Received<any>[], void, void> {
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/messages`;
    const base: GetRoomMessagesRequest = {
        ...(direction && { dir: directions[direction] }),
        ...(filter && { filter: JSON.stringify(filter) }),
    };

    let from: string | undefined;
    do {
        const query: GetRoomMessagesRequest = { ...base, ...(from && { from }) };
        const response: GetRoomMessagesResponse = await client.doRequest("GET", path, query);
        from = response.end;
        yield response.chunk;
    } while (from);
}

// Ensures no matrix IDs are in the content.body
function cleanContent(content: any) {
    if (typeof content !== "object") return content;
    if (content.body) {
        content.body = content.body.replace(/@[a-zA-Z0-9_\-\.=]+:[a-zA-Z0-9\-.]+/g, "<mxid>");
    }
    return content;
}

type BackfillState = {
    rooms: string[];
};

async function backfill(client: MatrixClient, indexer: Indexer) {
    // Check if we have a state file
    const filePath = "./storage/backfillState.json";
    if (!fs.existsSync(filePath)) {
        console.info("No backfill state found, writing empty state file");
        fs.writeFileSync(filePath, "{\"rooms\":[]}");
    }

    const stateJson = fs.readFileSync(filePath, "utf-8");
    const state: BackfillState = JSON.parse(stateJson);

    console.info("Indexing existing messages")
    const joined_rooms = await client.getJoinedRooms();

    // Remvoe rooms we've already indexed.
    // The already indexed are a list of strings in the rooms object on our state
    const newRooms = joined_rooms.filter(room => !state.rooms.includes(room));

    // Save the state file
    fs.writeFileSync(filePath, JSON.stringify(state));

    let editedEvents: string[] = [];

    for (const room of newRooms) {
        const pages = getRoomEvents(client, room, "reverse", { types: ["m.room.message"] });
        for await (const page of pages) {
            for (const event of page) {
                if (editedEvents.includes(event["event_id"])) {
                    continue;
                }
                if (event.content["m.relates_to"]) {
                    if (event.content["m.relates_to"].rel_type === "m.replace") {
                        editedEvents.push(event.content["m.relates_to"].event_id);
                    }
                }
                
                if (await client.crypto.isRoomEncrypted(room)) {
                    await client.crypto.onRoomEvent(room, event);
                } else {
                    const res = await indexer.insert({ id: event["event_id"].replace("$", "").replace(":", "_").replace(".", "_"), sender: event["sender"], content: cleanContent(event["content"]), room_id: room });
                    console.info(`Indexed message:`, res);
                }
            }
        }

        // Add the room to the state and save it
        state.rooms.push(room);
        fs.writeFileSync(filePath, JSON.stringify(state));
    }
}

async function run() {

    const storageProvider = new SimpleFsStorageProvider("./storage/bot.json");
    const cryptoProvider = new RustSdkCryptoStorageProvider("./storage/crypto", RustSdkCryptoStoreType.Sqlite);

    const config = new Config();
    const homeserverUrl = config.homeserverUrl;
    const accessToken = config.accessToken;
    const indexer = new Indexer();

    const client = new MatrixClient(homeserverUrl, accessToken, storageProvider, cryptoProvider);

    client.on("room.message", async (roomId, event) => {
        if (event["content"]["msgtype"] === "m.text") {
            console.info(`Received message in room ${roomId}`);

            const res = await indexer.insert({ id: event["event_id"].replace("$", "").replace(":", "_").replace(".", "_"), sender: event["sender"], content: cleanContent(event["content"]), room_id: roomId });
            console.info(`Indexed message:`, res);
        }
    });

    await client.start();
    console.info("Bot started!");

    await backfill(client, indexer);

}

await run();