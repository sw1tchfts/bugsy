import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, checkTemplate, render, templateFor, textToHtml } from "@/lib/messaging/templates";

describe("message templates (spec 11 rule 10)", () => {
  it("ships defaults that use only their purpose's variables", () => {
    for (const key of TEMPLATE_KEYS) {
      for (const t of Object.values(DEFAULT_TEMPLATES[key])) expect(checkTemplate(key, t!), key).toEqual([]);
    }
  });

  it("refuses a variable the purpose does not have", () => {
    expect(checkTemplate("reminder", { subject: null, body: "Hi {{customer_name}}, your total is {{invoice_total}}" })).toEqual(["invoice_total"]);
  });

  it("renders variables, missing ones empty, and escapes HTML in email", () => {
    expect(render("Hi {{ customer_name }}, see {{summary_url}}{{nothing}}", { customer_name: "Maria", summary_url: "https://x.test/m/abc" })).toBe("Hi Maria, see https://x.test/m/abc");
    expect(textToHtml("Hi <Maria> & co\nline two\n\nhttps://x.test/m/a?b=1")).toBe('<p>Hi &lt;Maria&gt; &amp; co<br>line two</p>\n<p><a href="https://x.test/m/a?b=1">https://x.test/m/a?b=1</a></p>');
  });

  it("uses the company's override when it has one, the email text for mail, and nothing where no template exists", () => {
    expect(templateFor("reminder", "sms", [{ key: "reminder", channel: "sms", subject: null, body: "Custom {{visit_date}}" }])?.body).toBe("Custom {{visit_date}}");
    expect(templateFor("reminder", "email", [{ key: "reminder", channel: "sms", subject: null, body: "Custom" }])?.subject).toBe("Your visit {{visit_date}}");
    expect(templateFor("notice.post_application", "mail", [])?.subject).toBe("Pesticide application information");
    expect(templateFor("invoice", "sms", [])).toBeNull();
  });
});
