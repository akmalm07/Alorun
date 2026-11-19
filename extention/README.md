# Alorun browser extension

Alorun’s Plasmo extension for Chrome 120+ and Firefox 140+. Browser-specific code lives in this directory. The extension and the existing Alorun app share their navigation, API schemas, and conversation and settings rules through the repository’s `src/` directory.

## Build and load

Install the repository dependencies from the Alorun root with `pnpm install --frozen-lockfile`. Then run these commands from this directory.

```sh
npm ci
```

- **Chrome** — Run `npm run build`. In `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select `extention/build/chrome-mv3-prod`.
- **Firefox** — Run `npm run build:firefox`. In `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and select `extention/build/firefox-mv3-prod/manifest.json`. Firefox removes a temporary installation when the browser exits.

Open a website, then open Alorun from the Extensions menu. After rebuilding, reload Alorun from your browser’s extension manager.

## Use the page tools

- **Change this for me** opens a conversation for the current page. Try `Put "Reports" and "New note" at the top in a compact, two-column panel. Most visited first.` Use labels that appear on the page. You can revise the preview with another message, change its position, spacing, or column count, and add or remove shortcuts. The panel adapts to its available width.
- **Yes, remember it** saves the layout and requests access to the current host. Alorun restores it for the same origin and path, including supported hash routes. **Just for now** keeps a preview for the current page visit. **Forget layout** removes a remembered layout from that page.
- **Most visited** ranks nearby pages on the same origin after you save a layout. Visits are counted from that point onward. The list uses path and title, omits query strings and standard anchor fragments, and is stored with the layout in the current browser profile. Forgetting the last layout on a site clears its visit counts.
- **Act on this page** accepts a short series of explicit steps, such as `Click "New note" then type "Draft update" into "Note".` Review the steps and press **Run on page**. The on-page pointer follows the targets and types at the end of each field one character at a time. Select **Stop** or press **Escape** to stop. Use a new prompt after navigating to another page.

Both tools use local rules, so they work without a model account or API key. A layout adds a panel of shortcuts to existing controls and works alongside the original page. Controls need unique labels. The runner supports ordinary visible controls and editable text in the top-level page. Actions that rely on iframes, inaccessible controls, sensitive fields, form submission, or trusted native mouse events can require direct interaction. The extension cannot customize internal browser pages.

## Connect your Alorun account

Copy `.env.example` to `.env`, set the URL for the existing Alorun NestJS API, and supply the Supabase project URL and **public anon/publishable key**. Rebuild the extension and use your existing Alorun password sign-in. The page tools work independently of this connection.

| Workspace section | Browser controls                                                                        |
| ----------------- | --------------------------------------------------------------------------------------- |
| Today & goals     | View goals and scheduled tasks, create a goal, and complete or reopen tasks             |
| Conversations     | Use Companion’s Listen, Think, and Plan modes with the existing chat-history preference |
| Missions          | View missions and run history, pause and resume                                         |
| Settings chat     | Find account settings, update history and voice check-in preferences, and sign out      |

Site layouts, visit counts, and browser action prompts stay on the device. Connected workspace screens use the existing Supabase and Alorun services. Browser action prompts are kept only in the open popup and active run.

## Verification

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npx playwright install chromium
npm run test:browser
npm run test:browser:firefox
```

The suites run the same five scenarios in isolated profiles using a loopback website and a fixture for the existing Alorun and Supabase API contracts. The test bundles pre-grant access only to the fixture host. Native permission dialogs are outside these suites. The fixture port defaults to 41287 and can be changed with `ALORUN_BROWSER_TEST_ORIGIN`.

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to test with a local Chrome or Chromium binary that supports unpacked extensions. Firefox tests require Firefox and geckodriver. Set `FIREFOX_BINARY` and `GECKODRIVER_PATH` if they are outside the usual locations. The Firefox restart test reinstalls the temporary add-on in the same profile and preserves extension storage in that test profile.
