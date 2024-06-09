import { MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } from "matrix-bot-sdk";
import Indexer from "./indexer.js";

const storageProvider = new SimpleFsStorageProvider("./storage/bot.json");
const cryptoProvider = new RustSdkCryptoStorageProvider("./storage/crypto");

//TODO: get these from a config or env vars
const homeserverUrl = "https://matrix.org";
const accessToken = "";
const indexer = new Indexer();
await indexer.init();

const client = new MatrixClient(homeserverUrl, accessToken, storageProvider, cryptoProvider);

client.on("room.message", async (roomId, event) => {
    if (event["content"]["msgtype"] === "m.text") {
        const body = event["content"]["body"];
        console.info(`Received message in room ${roomId}: ${body}`);

        await indexer.insert(event["content"]);
    }
});

client.start().then(() => {
    console.info("Bot started!");
});