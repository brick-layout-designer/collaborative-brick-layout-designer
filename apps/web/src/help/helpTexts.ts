// The help behind every "?" button, in plain words for club members.
// `short` is one sentence, shown on hover; `more` is two or three,
// shown on click. The desktop app (src/ui/help/HelpTexts.{h,cpp}) uses
// the same keys and the same words: help-keys.txt next to this file is
// the key list it copies, and helpTexts.test.ts keeps the two in step.
//
// In the words people see, layers are "sheets" and the venue is the
// "room". Keys keep their own names and never change once shipped.

export interface HelpEntry {
  /** The name of the thing, shown at the top of the popover. */
  title: string;
  /** One sentence, 140 characters at most. */
  short: string;
  /** Two or three short sentences. */
  more: string;
  /** An in-app help page (a path on this server, never a full address). */
  learnMoreUrl?: string;
}

export const HELP_TEXTS = {
  // Panels
  'panel.parts': {
    title: 'Parts',
    short: 'All the pieces you can build with.',
    more: 'Search by name or number, or pick a group like track or plates. Drag a part onto the map, or click it to drop it in the middle.',
    learnMoreUrl: '/help#getting-started',
  },
  'panel.sheets': {
    title: 'Sheets',
    short: 'Sheets are see-through pages stacked on the map, to keep things apart.',
    more: 'Put track on one sheet and buildings on another. Hide a sheet to see under it, or lock it so nothing on it moves by accident. New parts go on the sheet that is picked.',
    learnMoreUrl: '/help#sheets',
  },
  'panel.partsList': {
    title: 'Parts list',
    short: 'Every part this layout uses, with how many of each.',
    more: 'Use it to check what you need to bring to a show. If the layout has a budget, parts over their limit are marked.',
  },
  'panel.modules': {
    title: 'Modules',
    short: 'Groups of pieces kept together, so you can move or reuse them as one.',
    more: 'A module is like a table section: pick it to select everything in it at once. Save a module to reuse it in other layouts.',
  },
  'panel.moduleLibrary': {
    title: 'Module library',
    short: 'Modules saved to your account or your club, ready to drop in.',
    more: 'Drag a module from here onto the map to add a copy of it. Your club’s modules are shared with everyone in the club. To change a module, open it from Home: it opens on its own, and Save module keeps your changes.',
  },
  'panel.roomLibrary': {
    title: 'Venue library',
    short: 'Venues saved to your account or your club.',
    more: 'Put a venue under your layout to check that it fits, with space to walk around. Anyone in your club can use the club’s venues.',
    learnMoreUrl: '/help#room',
  },
  'panel.views': {
    title: 'Views',
    short: 'Saved views remember a part of the layout, so you can show it again in one tap.',
    more: 'A view can fit the whole layout or keep one area, and show only some sheets. Share a picture of any view, or export a picture of every view at once after a change.',
  },

  // Top bar
  'topbar.saveStatus': {
    title: 'Saving',
    short: 'Shows whether your changes are saved; everything saves by itself.',
    more: '“Saved” means the server has everything. If you go offline, keep working: your changes are kept here and saved when you are back.',
  },
  'topbar.tasks': {
    title: 'Tasks',
    short: 'Jump to what you want to do: build, draw the venue, add notes or see the parts list.',
    more: 'Each task opens the panels you need for it. Nothing is lost when you switch between them.',
  },
  'people.here': {
    title: 'People here now',
    short: 'The people working on this layout right now.',
    more: 'Everyone sees each other’s changes as they happen. A faded circle means that person has stepped away for a bit.',
    learnMoreUrl: '/help#sharing',
  },

  // Toolbar and tool rail
  'toolbar.snap': {
    title: 'Snap',
    short: 'Pieces jump to the nearest grid line, so rows stay straight.',
    more: 'The number is how far apart the grid lines are, in studs. Pick “off” to place something exactly where you drop it. Track ends still click together.',
  },
  'toolbar.rotateStep': {
    title: 'Turn step',
    short: 'How far a piece turns each time you press R.',
    more: 'Pick 90° for square turns, or a smaller step for curves and angles. Shift+R turns the other way.',
  },
  'toolbar.paintColour': {
    title: 'Paint colour',
    short: 'The colour the Paint tool uses.',
    more: 'Pick a colour here, then choose Paint and click on the map to colour an area. It paints the ground, not the pieces.',
  },
  'toolbar.panels': {
    title: 'Panels',
    short: 'Show or hide the side panels.',
    more: 'Tick a panel to show it. You can also drag a panel by its handle to move it, or float it over the map.',
  },
  'tools.rail': {
    title: 'Tools',
    short: 'Pick what a click on the map does.',
    more: 'Select moves pieces. Measure and Circle add a ruler you can keep on the map. Venue and Obstacle draw the walls of the venue and things to keep clear of.',
    learnMoreUrl: '/help#shortcuts',
  },

  // Status bar
  'status.sheet': {
    title: 'Current sheet',
    short: 'New parts go on this sheet.',
    more: 'Pick a different sheet in the Sheets panel to put new parts there instead. Each sheet keeps its own parts.',
    learnMoreUrl: '/help#sheets',
  },
  'status.room': {
    title: 'Venue check',
    short: 'Says whether the layout fits the venue, with space to walk around.',
    more: 'It checks for pieces outside the walls, on top of obstacles, or too close to leave a walkway. Point at it to see what needs fixing.',
    learnMoreUrl: '/help#room',
  },
  'status.budget': {
    title: 'Budget',
    short: 'Says whether the layout stays within the parts you have.',
    more: 'A budget is how many of each part you own. “Over” means the layout uses more of some part than you have.',
  },

  // Dialogs in the editor
  'dialog.budget': {
    title: 'Budget',
    short: 'Set how many of each part you have, so the layout never uses more.',
    more: 'Type a number next to a part to set its limit. Save the budget to a file to use it again, or open one a friend made.',
  },
  'dialog.sheetOptions': {
    title: 'Sheet options',
    short: 'The name and look of this sheet.',
    more: 'Make a sheet see-through to show what is under it. Hidden and locked sheets stay in the layout; they just can’t be seen or changed.',
    learnMoreUrl: '/help#sheets',
  },
  'dialog.label': {
    title: 'Labels',
    short: 'A label is a note pinned to a piece, and it moves with it.',
    more: 'Use labels to name a station or a street. If the piece moves, its label moves too.',
  },
  'dialog.measure': {
    title: 'Measure',
    short: 'A ruler on the map that shows a real distance.',
    more: 'Rulers stay on the map until you delete them, so others can see them too. Change its colour, or show the length in studs, metres or feet.',
  },
  'dialog.exportImage': {
    title: 'Export or print',
    short: 'Make a picture of the layout to share or print.',
    more: 'Pick the part of the map and the size. Printing can spread a big layout over several pages.',
  },
  'dialog.exportPartList': {
    title: 'Export the parts list',
    short: 'Save the list of parts as a file, for shopping or packing.',
    more: 'HTML has pictures and opens in a browser. CSV opens in a spreadsheet.',
  },

  // Downloading
  'download.formats': {
    title: 'Download as',
    short: 'Save a copy of this layout on your computer.',
    more: 'The layout file keeps everything and opens in this app or the desktop app. The other choices are for other programs and may leave some things out.',
    learnMoreUrl: '/help#files',
  },
  'download.layout': {
    title: 'Layout file',
    short: 'Everything in one file: parts, sheets, venue, labels and modules.',
    more: 'Pick this to keep a backup or to open the layout in the desktop app. Nothing is left out.',
    learnMoreUrl: '/help#files',
  },
  'download.bbm': {
    title: 'BlueBrick map',
    short: 'For people who still use the old BlueBrick program.',
    more: 'BlueBrick can’t hold everything this app can, so the venue, labels, modules and background picture are left out. Your layout here keeps them.',
    learnMoreUrl: '/help#files',
  },

  // Share and people
  'share.roles': {
    title: 'Viewer or editor',
    short: 'Editors can change the layout; viewers can only look.',
    more: 'Invite people by email. They get a link to join, and can see changes as they happen. You can change their role or remove them later.',
    learnMoreUrl: '/help#sharing',
  },
  'share.people': {
    title: 'People',
    short: 'Everyone who can open this layout.',
    more: 'The owner decides who else can see or change the layout. Anyone here can open it from their own list of layouts.',
    learnMoreUrl: '/help#sharing',
  },
  'share.pending': {
    title: 'Waiting to join',
    short: 'People you invited who haven’t joined yet.',
    more: 'Invites stop working after a while. Cancel one if you sent it to the wrong address.',
  },
  'share.transfer': {
    title: 'Give it to someone else',
    short: 'Hand this layout to another person or to your club.',
    more: 'The new owner decides who can see and change it. Give it to your club so it stays with the club, not with one person.',
  },
  'share.publicLink': {
    title: 'Public link',
    short: 'Anyone with the link can look at the layout, without signing in.',
    more: 'They can look but not change anything. Turn the link off and it stops working straight away.',
    learnMoreUrl: '/help#sharing',
  },
  'share.history': {
    title: 'History',
    short: 'What happened to this layout, and when: who opened, shared or saved a copy of it.',
    more: 'It helps you see who has been working on the layout. It doesn’t list every piece that moved.',
  },
  'share.picture': {
    title: 'Share a picture',
    short: 'Send a picture of the layout to anyone, even people without an account.',
    more: 'Pick the whole layout, what is on screen, or a saved view. On a phone it opens your share menu; on a computer it saves the picture or copies it.',
  },
  'share.exportAllViews': {
    title: 'Export all views',
    short: 'One picture of every saved view, all in one zip file.',
    more: 'After you change the layout, do it again to get fresh pictures with the same names. The size you pick is remembered.',
  },

  // Settings
  'settings.sync': {
    title: 'Where settings are kept',
    short: 'Signed in, your settings follow you to any computer.',
    more: 'They are kept with your account on this server. Signed out, they are kept in this browser only.',
  },
  'settings.colour': {
    title: 'Colour',
    short: 'The colour of buttons and highlights; your bricks keep their own colours.',
    more: 'Pick the one you like best. It only changes how the app looks for you.',
  },
  'settings.largeText': {
    title: 'Bigger text and buttons',
    short: 'Makes words and buttons larger and easier to hit.',
    more: 'Handy on a small screen or if reading is tiring. The map zoom doesn’t change.',
  },
  'settings.helpIcons': {
    title: 'Help buttons',
    short: 'The small round question marks, like this one.',
    more: 'Turn them off once you know your way around. You can turn them back on here or from the Help menu.',
  },
  'settings.tours': {
    title: 'Tours',
    short: 'Short guided walks through the app.',
    more: 'A tour points at the real buttons, one step at a time. Press “Show tours again” to see the ones you have already finished.',
  },

  // The venue designer
  'room.tools': {
    title: 'Drawing tools',
    short: 'Pick what to draw: walls, doors, columns, power points and more.',
    more: 'Click on the drawing to place things. While drawing, type a length and press Enter to make it exact.',
    learnMoreUrl: '/help#room',
  },
  'room.units': {
    title: 'Units',
    short: 'Show lengths in feet and inches, metres or studs.',
    more: 'Change it any time: the venue stays the same size. A stud is 8 mm, the width of one LEGO bump.',
  },
  'room.snap': {
    title: 'Snap',
    short: 'Lines jump to corners, walls and straight angles as you draw.',
    more: 'Turn it off to draw freely. Hold Shift while drawing to go at any angle for a moment.',
  },
  'room.floorPlan': {
    title: 'Floor plan',
    short: 'Put a picture of the venue’s plan underneath, and trace over it.',
    more: 'A photo or a drawing both work. Scale it by clicking two points you know the real distance between.',
    learnMoreUrl: '/help#room',
  },
  'room.calibrate': {
    title: 'Scale the floor plan',
    short: 'Make the picture the right size by measuring one known distance.',
    more: 'Click Calibrate, then click two points on the picture, like the ends of a wall. Type the real distance between them and the picture is scaled to fit.',
  },
  'room.show': {
    title: 'Show',
    short: 'Hide parts of the drawing to see the rest more clearly.',
    more: 'Hiding something only hides it here. It is still part of the venue.',
  },
  'room.walkway': {
    title: 'Walkway',
    short: 'The space to leave clear around the layout for people to walk.',
    more: 'The venue check warns you when the layout comes closer than this to a wall or an obstacle. It starts at about 90 cm.',
  },
  'room.estimates': {
    title: 'Estimates',
    short: 'Lengths you guessed and still need to measure.',
    more: 'Mark a length as an estimate when you don’t know it yet. Measure it at the hall later and type in the real number.',
  },

  // Parts That Differ
  'partsDiffer.about': {
    title: 'Parts that differ',
    short: 'This file has its own version of some parts the server already has.',
    more: 'Maybe someone changed a part’s picture. Compare the two and choose which one to use.',
  },
  'partsDiffer.choice': {
    title: 'Which to use',
    short: 'Keep the server’s part, use the file’s, or keep both.',
    more: '“Use the file’s” replaces the part for everyone on this server. “Keep both” adds the file’s under a new number, and only this layout uses it.',
  },

  // Yours and your clubs'
  'owners.filter': {
    title: 'Whose things',
    short: 'Show everything you can use, only your own, or one club’s.',
    more: 'Your own things and your clubs’ things sit in one list, each marked with who owns it. Pick a club to see just its things; new things are saved there too unless you choose otherwise.',
  },

  // Joining a club
  'club.whoCanJoin': {
    title: 'Who can join',
    short: 'Choose how new people get into the club.',
    more: 'Invite only: people join with an invite from an admin. Ask to join: people send a request and an admin says yes or no. Open: anyone signed in can join straight away, as a member.',
  },
  'club.listed': {
    title: 'Show in the club list',
    short: 'Let people find the club under Find a club.',
    more: 'Everyone signed in sees its name, its description and how many members it has. Leave it off to keep the club hidden, so only people you invite know about it.',
  },
  'club.requests': {
    title: 'Requests to join',
    short: 'People who asked to join the club, waiting for an admin.',
    more: 'Approve to make them a member. Decline to say no; they aren’t told, and they can ask again later.',
  },
  'club.roles': {
    title: 'Roles in the club',
    short: 'Admins run the club, managers run its day to day, members use it.',
    more: 'Admins change the club’s settings and roles, and can hand over or delete the club. Managers invite people, answer requests to join, remove members and look after the club’s things. Members use and add the club’s layouts, venues, modules and parts.',
  },
  'club.find': {
    title: 'Find a club',
    short: 'Clubs that chose to be listed here, for anyone to find.',
    more: 'Join an open club straight away, or ask to join and wait for an admin to say yes. Some clubs take new members by invite only.',
  },
  // Catalog collections
  'catalog.collections': {
    title: 'Collections',
    short: 'Sets of modules and parts that go well together, like “Starter town”.',
    more: 'Open one to see what’s in it, then add one item or Add all to copy everything to you or your club. Anyone signed in can make a collection.',
    learnMoreUrl: '/help#collections',
  },
  'catalog.yourCollections': {
    title: 'Your collections',
    short: 'Collections you made: private ones only you see, public ones are in the catalog.',
    more: 'Make one with New collection, or use “Add to a collection…” on any module or part. A public collection’s title, description and cover are checked by a moderator first; each item is checked on its own.',
    learnMoreUrl: '/help#collections',
  },
  'catalog.clubCollections': {
    title: 'Your clubs’ collections',
    short: 'Collections your clubs made: every member sees them, and admins and managers change them.',
    more: 'A club can keep a collection to itself, like its show standards, or share it with everyone in the catalog under the club’s name. Pinned ones come first.',
    learnMoreUrl: '/help#collections',
  },
  'club.trusted': {
    title: 'Trusted club',
    short: 'A trusted club’s own admins and managers check what it shares, instead of the site’s moderators.',
    more: 'What an admin or manager shares under the club’s name goes public at once; what a member shares waits in the club’s own review. The site’s moderators can still see and take down anything, and can stop trusting a club.',
    learnMoreUrl: '/help#collections',
  },
  'collection.audience': {
    title: 'Who can see this',
    short: 'Private is only you or your club’s members; Everyone puts it in the public catalog after a check.',
    more: 'A moderator checks a public collection’s title, description and cover first. Adding or moving items never needs a check, but your own modules and parts are each checked before they show publicly.',
    learnMoreUrl: '/help#collections',
  },
  'account.publicName': {
    title: 'Your name',
    short: 'Other people see this name, so pick one you are happy to share; your email stays private.',
    more: 'It shows in club member lists, next to your cursor when you edit with others, and on things you share in the public catalog. You can change it any time on your Profile page.',
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpKey = keyof typeof HELP_TEXTS;

export const HELP_KEYS = Object.keys(HELP_TEXTS) as HelpKey[];

export function helpText(key: HelpKey): HelpEntry {
  return HELP_TEXTS[key];
}
