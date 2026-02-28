import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import type { ReactNode } from "react";

interface AuthGateProps {
  children: ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  return (
    <>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center bg-neutral-950">
          <SignIn />
        </div>
      </SignedOut>
      <SignedIn>{children}</SignedIn>
    </>
  );
}
