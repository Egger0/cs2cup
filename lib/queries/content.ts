import 'server-only'

export { adminCreateGame, adminDeleteGame, adminListGames, adminSaveGame } from './content/games'
export { adminCreatePost, adminDeletePost, adminListPosts, adminSavePost } from './content/posts'
export {
  adminCreateMember,
  adminDeleteMember,
  adminListMembers,
  adminSaveMember,
} from './content/members'
export {
  adminCreateOfficialGuestbookReply,
  adminDeleteGuestbookMessage,
  adminListGuestbookMessages,
  adminSetGuestbookMessagePinned,
  adminSetGuestbookMessageStatus,
} from './content/guestbook'
export {
  adminCreateTournament,
  adminDeleteTournament,
  adminListTournaments,
  adminSaveTournament,
} from './content/tournaments'
export {
  adminDeletePhoto,
  adminGetPhoto,
  adminInsertPhoto,
  adminListPhotos,
} from './content/photos'
export { adminGetSiteSetting, adminSaveSiteSetting } from './content/settings'
