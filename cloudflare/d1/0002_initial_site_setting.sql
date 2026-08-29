INSERT INTO site_setting (
  id,
  club_name,
  club_name_en,
  school,
  logo_url,
  contact_qq,
  contact_wechat,
  footer_copy
) VALUES (
  1,
  '宁波理工电竞社',
  'ESPORTS CLUB',
  '浙大宁波理工学院',
  '/brand/club-logo.jpg',
  '661543515',
  '无',
  '© 2026 宁波理工电竞社'
)
ON CONFLICT(id) DO NOTHING;
