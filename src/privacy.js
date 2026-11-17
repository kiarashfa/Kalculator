// ═══════════════════════════════════════════════════════════════════════════
// The privacy policy: the ONE place its text is written. The app shows it in
// Help → Privacy (and at /Kalculator/#privacy, the address given to Google's
// consent screen); vite.config.js also writes it into index.html as a
// <noscript> block, so a crawler or reviewer that does not run scripts reads
// the same words. Plain data only (no imports), so Node can load it.
//
// Paragraphs are strings, or arrays mixing strings and { href, text } links.
// House style: no dashes in visible text. There is deliberately no "last
// updated" date: it would be one more thing to keep true.
// ═══════════════════════════════════════════════════════════════════════════
export const PRIVACY_CONTACT = "kiarashfa@gmail.com";

export const PRIVACY = [
  {
    title: "In short",
    text: [
      "Kalculator has no server and no accounts. Your calculations, documents and profile stay in your browser. They go somewhere else only if you download a save file or connect your own Google Drive or Dropbox.",
    ],
  },
  {
    title: "Your profile and save file",
    text: [
      "Your name and picture are stored on your device. Your save file is a plain file you download. It holds your documents and profile, so keep it private. Kalculator never uploads it.",
    ],
  },
  {
    title: "Google Drive and Dropbox",
    text: [
      "Cloud save is optional. Kalculator keeps one file in a private app folder in your own Google Drive or Dropbox, and it cannot see anything else there. It also reads the name and email of the account you connect, only to show who is connected. Everything goes directly between your browser and Google or Dropbox, never through us.",
      [
        "Kalculator's use and transfer of information received from Google APIs adheres to the ",
        { href: "https://developers.google.com/terms/api-services-user-data-policy", text: "Google API Services User Data Policy" },
        ", including the Limited Use requirements. The information is used only to save and load your own file, and is never shared or used for advertising.",
      ],
      [
        "To disconnect, choose Disconnect in your profile. To delete the file, remove Kalculator's data in ",
        { href: "https://myaccount.google.com/connections", text: "your Google account" },
        " or its folder in Dropbox. Signing out removes everything from this browser.",
      ],
    ],
  },
  {
    title: "Analytics",
    text: [
      "Google Analytics counts visits, such as the page, rough location and browser type. It never receives your calculations, documents or profile.",
    ],
  },
  {
    title: "Contact",
    text: [`Questions? Write to ${PRIVACY_CONTACT}.`],
  },
];
