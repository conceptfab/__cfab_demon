import React, { useState, useRef } from "react";
import { Bug, Paperclip, X, Send, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BugHunterProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
}

interface AttachedFile {
  file: File;
  id: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function BugHunter({ isOpen, onClose, version }: BugHunterProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: AttachedFile[] = [];
    for (let i = 0; i < files.length; i++) {
        if (files[i].size > MAX_FILE_SIZE) {
            alert(`Plik ${files[i].name} jest za duży (max 5MB)`);
            continue;
        }
        newAttachments.push({
            file: files[i],
            id: Math.random().toString(36).substring(7)
        });
    }
    setAttachments([...attachments, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter((a) => a.id !== id));
  };

  const handleSend = async () => {
    if (!title || !description) return;
    setIsSending(true);

    try {
      const attachmentsData = await Promise.all(
        attachments.map(async (atch) => {
          const buffer = await atch.file.arrayBuffer();
          return [atch.file.name, Array.from(new Uint8Array(buffer))];
        })
      );

      const result = await invoke<{ ok: boolean; message: string }>("send_bug_report", {
        subject: title,
        message: description,
        version: version,
        attachments: attachmentsData,
      });

      if (!result.ok) {
        throw new Error(result.message || "Failed to send report");
      }

      setIsSending(false);
      setIsSent(true);

      setTimeout(() => {
        setIsSent(false);
        setTitle("");
        setDescription("");
        setAttachments([]);
        onClose();
      }, 2000);
    } catch (error) {
      console.error("BugHunter failed to send:", error);
      alert(`Błąd wysyłki: ${error}`);
      setIsSending(false);
    }
  };



  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-3 rounded-md border border-border/90 bg-card/98 p-5 shadow-[0_18px_48px_rgba(0,0,0,0.45)] outline-none">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-destructive/10 text-destructive">
                <Bug className="h-4 w-4" />
            </div>
            <DialogTitle className="text-xl font-semibold tracking-tight">BugHunter</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            Zgłoś błąd lub sugestię bezpośrednio do admina.
          </DialogDescription>
        </DialogHeader>

        {isSent ? (
          <div className="flex flex-col items-center justify-center py-10 space-y-4 animate-in fade-in zoom-in duration-300">
            <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <Check className="h-6 w-6 stroke-[3px]" />
            </div>
            <p className="text-sm font-medium text-emerald-300">Zgłoszenie zostało wysłane!</p>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="grid gap-1.5">
              <Label htmlFor="subject" className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Temat (wersja {version})</Label>
              <Input
                id="subject"
                placeholder="Krótki opis błędu..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-secondary/20 border-border/40 text-[13px] h-9"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="message" className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Opis problemu</Label>
              <textarea
                id="message"
                placeholder="Co się stało? Jakie kroki podjąłeś? Zaraz to naprawimy..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="flex min-h-[140px] w-full rounded-md border border-border/40 bg-secondary/20 px-3 py-2 text-[13px] shadow-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none transition-colors"
                spellCheck={false}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Załączniki (max 5MB/plik)</Label>
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-[10px] text-sky-400 hover:text-sky-300 transition-colors font-semibold"
                >
                    <Paperclip className="h-3 w-3" />
                    DODAJ PLIKI
                </button>
              </div>
              <input
                type="file"
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {attachments.map((atch) => (
                    <div
                      key={atch.id}
                      className="group flex items-center gap-2 rounded bg-secondary/40 border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-all"
                    >
                      <span className="truncate max-w-[150px]">{atch.file.name}</span>
                      <button
                        onClick={() => removeAttachment(atch.id)}
                        className="text-muted-foreground group-hover:text-destructive transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="ghost"
                onClick={onClose}
                className="text-xs text-muted-foreground hover:text-foreground h-9 px-4"
              >
                Anuluj
              </Button>
              <Button
                onClick={handleSend}
                disabled={isSending || !title || !description}
                className="bg-primary text-primary-foreground text-xs font-semibold h-9 px-5 flex items-center gap-2 hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-primary/10"
              >
                {isSending ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {isSending ? "Wysyłanie..." : "Wyślij zgłoszenie"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
