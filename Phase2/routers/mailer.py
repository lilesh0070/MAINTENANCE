"""
routers/mailer.py — SMTP bhejne ka saada helper.

`pm_mail.py` (PM reminder mail) isi ka istemaal karta hai.
SMTP settings `.env` se: SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, List


def _split_addrs(s: Optional[str]) -> List[str]:
    """"a@x.com, b@y.com" -> ["a@x.com", "b@y.com"]"""
    if not s:
        return []
    return [x.strip() for x in s.split(",") if x.strip()]


def _send_email(subject: str, html: str,
                to_list: List[str], cc_list: List[str]):
    """Seedha SMTP send.  Fail hone par exception uthata hai (chupchaap nahi
    nigalta) — bulane wala tay kare ki usse kya karna hai."""
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587") or 587)
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    if not (smtp_user and smtp_pass):
        raise RuntimeError("SMTP credentials not configured in .env (SMTP_USER / SMTP_PASS)")
    if not to_list:
        raise RuntimeError("No To addresses")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = ", ".join(to_list)
    if cc_list:
        msg["Cc"] = ", ".join(cc_list)
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
        server.ehlo()
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_user, to_list + cc_list, msg.as_string())
