// 하단 탭 내비 — 페이지는 전부 마운트된 채 표시만 전환 (카메라 감지 유지)
// 아이콘 = 요정 UI 에셋 크롭 (assets/ui/nav-*.png)
const TABS = [
  { id: "main", img: "/assets/ui/nav-home.png", label: "홈" },
  { id: "group", img: "/assets/ui/nav-group.png", label: "그룹" },
  { id: "shop", img: "/assets/ui/nav-shop.png", label: "상점" },
  { id: "character", img: "/assets/ui/nav-character.png", label: "캐릭터" },
  { id: "login", img: "/assets/ui/nav-login.png", label: "로그인" },
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
