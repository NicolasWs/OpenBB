import { createRoot } from "react-dom/client";

function App() {
  return <h1>OpenBB Data</h1>;
}

Office.onReady(() => {
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<App />);
});
