# Browser extension architecture

The Plasmo Manifest V3 action renders the React popup. A Chrome service worker or Firefox background script owns persistent layout and visit writes. A bundled page runtime runs in the browser's isolated world and mounts the layout and cursor in separate Shadow DOM roots. It resolves user-specified labels against current page controls at action time.

On-demand injection uses the browser's temporary `activeTab` grant. The user can grant ongoing access to a host from the save decision. The service worker uses that access to reapply saved layouts on load and records visits only for an origin with at least one remembered layout. Storage keys use exact origins and normalized routes. Each site is limited to 50 layouts and 50 ranked visit records. There are no browser history reads or host permissions required at installation.

The action grammar produces a validated list of at most six reviewed clicks or typing steps. The popup ties the request to the inspected document and URL. The page runtime stops on cancellation, navigation, an unavailable or ambiguous control, or loss of focus. The browser's text insertion command inserts one grapheme per input event, preserving the page's editing behavior and avoiding clipboard writes.

The browser workspace is a client of the existing identity and API boundaries. It imports Alorun's shared schema and conversation code. No database, model vendor, or server changes are required for the extension. Local installation can be reversed by removing Alorun from the browser's extension manager.
