import { useAppStore } from "./lib/store";
import { ConnectStep } from "./components/ConnectStep";
import { FolderStep } from "./components/FolderStep";
import { ReviewStep } from "./components/ReviewStep";
import { DoneStep } from "./components/DoneStep";

const STEPS = ["connect", "folders", "review", "done"] as const;
const STEP_LABELS = ["Connect", "Add Music", "Review Matches", "Done"];

export default function App() {
  const step = useAppStore((s) => s.step);
  const currentIndex = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Step indicator */}
      <nav className="flex items-center justify-center gap-2 py-4 px-6 border-b border-zinc-800">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold
                ${i < currentIndex ? "bg-green-600 text-white" : ""}
                ${i === currentIndex ? "bg-green-500 text-white" : ""}
                ${i > currentIndex ? "bg-zinc-700 text-zinc-400" : ""}
              `}
            >
              {i < currentIndex ? "✓" : i + 1}
            </div>
            <span
              className={`text-sm ${i === currentIndex ? "text-white font-medium" : "text-zinc-500"}`}
            >
              {STEP_LABELS[i]}
            </span>
            {i < STEPS.length - 1 && (
              <div className="w-8 h-px bg-zinc-700 mx-1" />
            )}
          </div>
        ))}
      </nav>

      {/* Step content */}
      <main className="flex-1 overflow-auto p-6 max-w-4xl mx-auto w-full">
        {step === "connect" && <ConnectStep />}
        {step === "folders" && <FolderStep />}
        {step === "review" && <ReviewStep />}
        {step === "done" && <DoneStep />}
      </main>
    </div>
  );
}
