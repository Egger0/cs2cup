export const BROWSER_USERS = Object.freeze({
  applicant: Object.freeze({
    username: 'browser.applicant',
    displayName: '浏览器申请人',
    password: 'Sapphire meadow lantern 2026!',
  }),
  reviewer: Object.freeze({
    username: 'browser.reviewer',
    displayName: '浏览器审核员',
    password: 'Copper river telescope 2026!',
  }),
  rejectee: Object.freeze({
    username: 'browser.rejectee',
    displayName: '浏览器未通过申请人',
    password: 'Amber forest notebook 2026!',
  }),
  owner: Object.freeze({
    username: 'browser.owner',
    displayName: '浏览器负责人',
    password: 'Velvet harbor compass 2026!',
  }),
  signup: Object.freeze({
    username: 'browser.signup',
    displayName: '浏览器新注册账号',
    password: 'Juniper canvas orbit 2026!',
  }),
})

export const BROWSER_LEGACY = Object.freeze({
  displayName: '浏览器迁移账号',
  managementToken: 'm'.repeat(43),
  password: 'Quartz horizon willow garden 2029!',
  teamName: '浏览器旧报名',
  teamTag: 'OLDUI',
  tournamentId: 1,
  tournamentTitle: '2026 NLC 校园杯',
  username: 'browser.legacy',
})
