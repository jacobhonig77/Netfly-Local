export default function TabButton({ active, icon, label, onClick }) {
  return (
    <button className={`tab-btn ${active ? "active" : ""}`} onClick={onClick} type="button">
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
