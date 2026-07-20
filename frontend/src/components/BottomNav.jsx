// 하단 탭 내비 — 페이지는 전부 마운트된 채 표시만 전환 (카메라 감지 유지)
// 아이콘 = 요정 UI 에셋 크롭 (assets/ui/nav-*.png)
// B안 4탭: 공부방 · 함께(열품타) · 꾸미기(상점+캐릭터 통합) · 설정
const TABS = [
  { id: "main", img: "/assets/ui/nav-home.png", label: "공부방" },
  { id: "group", img: "/assets/ui/nav-group.png", label: "함께" },
  { id: "dressup", img: "/assets/ui/nav-character.png", label: "꾸미기" },
  { id: "settings", img: "/assets/ui/nav-login.png", label: "설정" },
];

export default function BottomNav({ page, onChange }) {
  return (
    <nav id="bottom-nav">
      {TABS.map((t) => (
        <button key={t.id} className={page === t.id ? "on" : ""} onClick={() => onChange(t.id)}>
          <img className="nav-ic" src={t.img} alt="" aria-hidden="true" />
          {t.label}
        </button>
      ))}
    </nav>
  );
}
