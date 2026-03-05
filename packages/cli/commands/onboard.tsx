import React, { useState, useEffect } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { isHex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { encrypt, keyfileExists, writeKeyfile } from "../signer/crypto.js";
import { getKeyfilePath } from "../signer/protocol.js";
import type { PolicyConfig } from "../signer/protocol.js";

// ── Policy presets ───────────────────────────────────────────────────────────

const POLICY_PRESETS: { name: string; description: string; policy: PolicyConfig }[] = [
  {
    name: "Conservative",
    description: "0.01 ETH max, approval always, mainnet only",
    policy: {
      maxValuePerTx: "0.01",
      allowedChains: [1],
      allowContractCreation: false,
      contracts: {},
      requireApproval: "always",
      approvalThresholdPct: 0,
    },
  },
  {
    name: "Moderate",
    description: "0.1 ETH max, approval above 50%, major L2s",
    policy: {
      maxValuePerTx: "0.1",
      allowedChains: [1, 8453, 42161, 137, 10],
      allowContractCreation: false,
      contracts: {},
      requireApproval: "above_threshold",
      approvalThresholdPct: 50,
    },
  },
  {
    name: "Permissive",
    description: "1.0 ETH max, no approval required, all major chains",
    policy: {
      maxValuePerTx: "1.0",
      allowedChains: [1, 8453, 42161, 137, 10, 43114, 56, 100],
      allowContractCreation: false,
      contracts: {},
      requireApproval: "never",
      approvalThresholdPct: 0,
    },
  },
];

// ── Selector component ───────────────────────────────────────────────────────

interface SelectorProps<T> {
  items: { label: string; description: string; value: T }[];
  onSelect: (value: T) => void;
}

function Selector<T>({ items, onSelect }: SelectorProps<T>) {
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setIndex((i) => Math.min(items.length - 1, i + 1));
    if (key.return) onSelect(items[index].value);
  });

  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Box key={i}>
          <Text color={i === index ? "cyan" : "gray"}>
            {i === index ? "❯ " : "  "}
            {item.label}
          </Text>
          <Text color="gray"> — {item.description}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Step types ───────────────────────────────────────────────────────────────

type Step = "welcome" | "key-source" | "import-key" | "passphrase" | "confirm-passphrase" | "policy" | "encrypting" | "summary";
type KeySource = "generate" | "import";

// ── Wizard ───────────────────────────────────────────────────────────────────

function Wizard() {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>("welcome");
  const [privateKey, setPrivateKey] = useState("");
  const [importInput, setImportInput] = useState("");
  const [importError, setImportError] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseInput, setPassphraseInput] = useState("");
  const [passphraseError, setPassphraseError] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [policyPreset, setPolicyPreset] = useState<PolicyConfig | null>(null);
  const [presetName, setPresetName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  useInput((_input, key) => {
    if (error && key.return) {
      exit();
    }
    if (step === "welcome" && !error && key.return) {
      setStep("key-source");
    }
    if (step === "summary" && key.return) {
      exit();
    }
  });

  // ── Error state ──────────────────────────────────────────────────────────

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>Error</Text>
        <Text color="red">{error}</Text>
        <Text> </Text>
        <Text color="gray">Press Enter to exit.</Text>
      </Box>
    );
  }

  // ── Step 1: Welcome ──────────────────────────────────────────────────────

  if (step === "welcome") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Welcome to Agentek</Text>
        <Text> </Text>
        <Text>This wizard will set up your local signing daemon.</Text>
        <Text>You'll create an encrypted keyfile with a spending policy.</Text>
        <Text> </Text>
        <Text color="gray">Press Enter to continue...</Text>
      </Box>
    );
  }

  // ── Step 2: Key Source ─────────────────────────────────────────────────

  if (step === "key-source") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>How would you like to set up your key?</Text>
        <Text> </Text>
        <Selector
          items={[
            { label: "Generate new key", description: "Create a fresh private key", value: "generate" as KeySource },
            { label: "Import existing key", description: "Provide a private key hex string", value: "import" as KeySource },
          ]}
          onSelect={(source) => {
            if (source === "generate") {
              const pk = generatePrivateKey();
              setPrivateKey(pk);
              setStep("passphrase");
            } else {
              setStep("import-key");
            }
          }}
        />
      </Box>
    );
  }

  // ── Step 3: Import Key ─────────────────────────────────────────────────

  if (step === "import-key") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Enter your private key (hex):</Text>
        <Text> </Text>
        <Box>
          <Text color="cyan">❯ </Text>
          <TextInput
            value={importInput}
            onChange={(v) => {
              setImportInput(v);
              setImportError("");
            }}
            mask="*"
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (!isHex(trimmed) || trimmed.length !== 66) {
                setImportError("Invalid key: must be a 0x-prefixed hex string (66 characters)");
                return;
              }
              setPrivateKey(trimmed);
              setStep("passphrase");
            }}
          />
        </Box>
        {importError && <Text color="red">{importError}</Text>}
        <Text color="gray">Must start with 0x (66 chars total)</Text>
      </Box>
    );
  }

  // ── Step 4: Passphrase ─────────────────────────────────────────────────

  if (step === "passphrase") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Choose a passphrase to encrypt your keyfile:</Text>
        <Text> </Text>
        <Box>
          <Text color="cyan">❯ </Text>
          <TextInput
            value={passphraseInput}
            onChange={(v) => {
              setPassphraseInput(v);
              setPassphraseError("");
            }}
            mask="*"
            onSubmit={(value) => {
              if (value.length < 8) {
                setPassphraseError("Passphrase must be at least 8 characters");
                return;
              }
              setPassphrase(value);
              setStep("confirm-passphrase");
            }}
          />
        </Box>
        {passphraseError && <Text color="red">{passphraseError}</Text>}
        <Text color="gray">Minimum 8 characters</Text>
      </Box>
    );
  }

  // ── Step 5: Confirm Passphrase ─────────────────────────────────────────

  if (step === "confirm-passphrase") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Confirm your passphrase:</Text>
        <Text> </Text>
        <Box>
          <Text color="cyan">❯ </Text>
          <TextInput
            value={confirmInput}
            onChange={(v) => {
              setConfirmInput(v);
              setConfirmError("");
            }}
            mask="*"
            onSubmit={(value) => {
              if (value !== passphrase) {
                setConfirmError("Passphrases do not match");
                setConfirmInput("");
                return;
              }
              setStep("policy");
            }}
          />
        </Box>
        {confirmError && <Text color="red">{confirmError}</Text>}
      </Box>
    );
  }

  // ── Step 6: Policy Preset ──────────────────────────────────────────────

  if (step === "policy") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Choose a spending policy preset:</Text>
        <Text> </Text>
        <Selector
          items={POLICY_PRESETS.map((p) => ({
            label: p.name,
            description: p.description,
            value: p,
          }))}
          onSelect={(preset) => {
            setPolicyPreset(preset.policy);
            setPresetName(preset.name);
            setStep("encrypting");
          }}
        />
      </Box>
    );
  }

  // ── Step 7: Encrypt & Save ─────────────────────────────────────────────

  if (step === "encrypting") {
    return <EncryptStep
      privateKey={privateKey}
      passphrase={passphrase}
      policy={policyPreset!}
      onDone={(addr) => {
        setAddress(addr);
        setStep("summary");
      }}
      onError={(msg) => setError(msg)}
    />;
  }

  // ── Step 8: Summary ────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">Setup complete!</Text>
      <Text> </Text>
      <Text>  Address:  <Text color="cyan">{address}</Text></Text>
      <Text>  Keyfile:  <Text color="gray">{getKeyfilePath()}</Text></Text>
      <Text>  Policy:   <Text color="yellow">{presetName}</Text></Text>
      <Text> </Text>
      <Text bold>Next steps:</Text>
      <Text>  agentek signer start    Start the signing daemon</Text>
      <Text>  agentek signer status   Check daemon status</Text>
      <Text> </Text>
      <Text color="gray">Press Enter to exit.</Text>
    </Box>
  );
}

// ── Encrypt step (side-effect in useEffect) ──────────────────────────────────

interface EncryptStepProps {
  privateKey: string;
  passphrase: string;
  policy: PolicyConfig;
  onDone: (address: string) => void;
  onError: (message: string) => void;
}

function EncryptStep({ privateKey, passphrase, policy, onDone, onError }: EncryptStepProps) {
  useEffect(() => {
    try {
      const keyfile = encrypt({ privateKey, policy }, passphrase);
      writeKeyfile(keyfile);
      const addr = privateKeyToAddress(privateKey as `0x${string}`);
      onDone(addr);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text>
        <Text color="cyan"><Spinner type="dots" /></Text>
        {" "}Encrypting keyfile and saving to disk...
      </Text>
    </Box>
  );
}

// ── Export handler ────────────────────────────────────────────────────────────

export function handleOnboard(): void {
  if (keyfileExists()) {
    process.stderr.write(
      `Error: Keyfile already exists at ${getKeyfilePath()}\n` +
      `Run "agentek signer status" to check your signer.\n`
    );
    process.exit(1);
  }

  const instance = render(<Wizard />);
  instance.waitUntilExit().then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
