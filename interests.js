// Your interests: the "signals" that orbit the core in Beyond (#/beyond).
// Edit this file freely; nothing else needs to change.
//
// Each category needs:
//   id     – short unique name, lowercase (used internally)
//   label  – shown in the HUD, keep it short (it's displayed in caps)
//   color  – accent colour as #rrggbb; the core turns this colour while the category is open
//   items  – the list. Each item has:
//              prompt – optional: the question it answers, shown as a small caption above it
//                       (e.g. 'FAVORITE SHOW'), so visitors know what the answer means
//              name   – your answer
//              note   – optional: one line on why you like it
//
// Number keys 1–6 open the categories in this order.
// Items still reading 'YOUR ANSWER HERE' are placeholders waiting to be filled in.

export const INTERESTS = [
  {
    id: 'shows',
    label: 'SHOWS',
    color: '#4cf0ff',
    items: [
      { prompt: 'FAVORITE SHOW', name: 'Jujutsu Kaisen', note: 'Gojo is my favorite character' },
      { prompt: 'ALSO LOVE', name: "JoJo's Bizarre Adventure" },
      { prompt: 'ALWAYS REWATCHING', name: 'Darling in the Franxx' },
    ],
  },
  {
    id: 'food',
    label: 'FOOD',
    color: '#ffb066',
    items: [
      { prompt: 'FAVORITE FOOD', name: 'Buldak Ramen', note: 'My favorite flavor is Yakisoba' },
      { prompt: 'GO-TO SNACK', name: 'Nutella' },
      { prompt: 'ALWAYS ORDER FROM', name: 'In-N-Out' },
    ],
  },
  {
    id: 'music',
    label: 'MUSIC',
    color: '#c39bff',
    items: [
      { prompt: 'FAVORITE ARTIST', name: 'YOUR ANSWER HERE', note: 'Optional: one line on why you like it' },
      { prompt: 'ALBUM ON REPEAT', name: 'YOUR ANSWER HERE' },
      { prompt: 'NEVER SKIP THIS SONG', name: 'YOUR ANSWER HERE' },
    ],
  },
  {
    id: 'games',
    label: 'GAMES',
    color: '#7dffb2',
    items: [
      { prompt: 'FAVORITE GAME', name: 'Legend of Zelda: Breath of the Wild', note: 'The best Legend of Zelda game' },
      { prompt: 'KEEP COMING BACK TO', name: 'Roblox' },
      { prompt: 'ON MY WISHLIST', name: 'GTA VI' },
    ],
  },
  {
    id: 'places',
    label: 'PLACES',
    color: '#6aa8ff',
    items: [
      { prompt: 'FAVORITE PLACE', name: 'Tokyo', note: 'I want to go to Shibuya Crossing' },
      { prompt: 'WANT TO VISIT', name: 'Seoul' },
      // TODO: the original question here was "a spot in your city", which doesn't fit England.
      // Add a prompt that matches your answer (e.g. 'WANT TO VISIT') or leave it without one.
      { name: 'England' },
    ],
  },
  {
    id: 'misc',
    label: 'MISC',
    color: '#ffe066',
    items: [
      { prompt: 'SOMETHING ELSE I LIKE', name: 'YOUR ANSWER HERE', note: 'Optional: one line on why you like it' },
      { prompt: 'A HOBBY', name: 'YOUR ANSWER HERE' },
      { prompt: 'BOOK, MOVIE OR ANYTHING ELSE', name: 'YOUR ANSWER HERE' },
    ],
  },
];
