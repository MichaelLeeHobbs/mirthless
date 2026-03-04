# 58 — Code Editor Enhancements

## ScriptEditor Language Toggle

- [ ] Open channel editor Scripts tab — editor loads with JavaScript mode
- [ ] Click "TS" toggle button — editor switches to TypeScript syntax highlighting
- [ ] Click "JS" toggle button — editor switches back to JavaScript
- [ ] Type TypeScript-only syntax (e.g., `const x: string = 'hello'`) — no errors in TS mode
- [ ] Language toggle appears in FilterRuleEditor (JavaScript filter type)
- [ ] Language toggle appears in TransformerStepEditor (JavaScript/Message Builder types)
- [ ] Language toggle appears in Global Scripts page editor
- [ ] Non-JavaScript filter/transformer types do NOT show language toggle

## Theme Sync

- [ ] In dark mode — editor uses `vs-dark` theme (dark background)
- [ ] In light mode — editor uses `vs` theme (light background)
- [ ] Toggle app theme — editor theme updates immediately

## IntelliSense & Autocomplete

- [ ] Type `msg.` — IntelliSense shows HL7 message properties
- [ ] Type `parseHL7(` — IntelliSense shows function signature
- [ ] Type `createACK(` — IntelliSense shows function signature
- [ ] Type `httpFetch(` — IntelliSense shows function signature with URL, options
- [ ] Type `dbQuery(` — IntelliSense shows function signature
- [ ] Type `routeMessage(` — IntelliSense shows function signature
- [ ] Type `getResource(` — IntelliSense shows function signature
- [ ] Type `$c(` — IntelliSense shows channelMap shortcut
- [ ] Type `$r(` — IntelliSense shows responseMap shortcut
- [ ] Type `$g(` — IntelliSense shows globalMap shortcut
- [ ] Type `$gc(` — IntelliSense shows configMap shortcut
- [ ] Type `globalMap.` — IntelliSense shows get/put/remove/containsKey
- [ ] Type `configMap.` — IntelliSense shows get/containsKey

## Editor Features

- [ ] Bracket pair colorization is enabled (matching brackets have colors)
- [ ] Auto-closing brackets works (type `{` → `}` auto-inserted)
- [ ] Format on paste works (paste indented code → auto-formatted)
