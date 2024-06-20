# Matrix Search

This tool is a meilisearch based indexer for a matrix account.
This was built due to the non existent e2ee search on element-web and is specifically
meant to work for my usecase. I am however open to suggestions.

## Requirements

- Nodejs
- Meilisearch
- PNPM

## Installation

```bash
pnpm install
pnpm run build
```

## Usage

To start the index you first have to fill the confix.yaml.
Have a look at the config.example.yaml for an example.

When you are done you can start the bot using:

```bash
node ./dist/bot.js
```

For searching you then can use the renderer.js file:

```bash
node ./dist/renderer.js
```

Fill in the prompts and you will get a pdf with the search results.
The room id and the sender are optional. They act as filters.
The relation between the 2 is an AND relation.

## License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.
