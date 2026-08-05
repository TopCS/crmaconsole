"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";

/**
 * Rich-text (WYSIWYG) email body editor for campaigns, built on the app's
 * existing TipTap v3 setup. Emits HTML via onChange.
 */
export function RichBodyEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        code: false,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write your email…",
        showOnlyWhenEditable: false,
      }),
      Link.configure({ openOnClick: false }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        style:
          "min-height: 180px; padding: 10px 12px; outline: none; color: var(--color-text); font-size: 13.5px; line-height: 1.55;",
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
  });

  const btn = (active: boolean) => ({
    background: active ? "var(--color-surface-hover)" : "transparent",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
  });

  return (
    <div
      className="rounded-lg"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 border-b" style={{ borderColor: "var(--color-border)" }}>
        {[
          {
            label: "B",
            title: "Bold",
            active: editor?.isActive("bold") ?? false,
            onClick: () => editor?.chain().focus().toggleBold().run(),
            style: { fontWeight: 700 },
          },
          {
            label: "I",
            title: "Italic",
            active: editor?.isActive("italic") ?? false,
            onClick: () => editor?.chain().focus().toggleItalic().run(),
            style: { fontStyle: "italic" },
          },
          {
            label: "H2",
            title: "Heading",
            active: editor?.isActive("heading", { level: 2 }) ?? false,
            onClick: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
          },
          {
            label: "• List",
            title: "Bullet list",
            active: editor?.isActive("bulletList") ?? false,
            onClick: () => editor?.chain().focus().toggleBulletList().run(),
          },
          {
            label: "1. List",
            title: "Ordered list",
            active: editor?.isActive("orderedList") ?? false,
            onClick: () => editor?.chain().focus().toggleOrderedList().run(),
          },
          {
            label: "Link",
            title: "Insert/edit link",
            active: editor?.isActive("link") ?? false,
            onClick: () => {
              if (!editor) {return;}
              if (editor.isActive("link")) {
                editor.chain().focus().unsetLink().run();
                return;
              }
              const url = window.prompt("Link URL");
              if (url) {
                editor.chain().focus().setLink({ href: url }).run();
              }
            },
          },
        ].map((b) => (
          <button
            key={b.title}
            type="button"
            title={b.title}
            onClick={b.onClick}
            className="rounded-md px-2 py-1 text-xs"
            style={{ ...btn(b.active), ...(b.style ?? {}) }}
          >
            {b.label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
