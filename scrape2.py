from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto("https://chatgpt.com/canvas/shared/69cf3e4f2ddc8191b5da5766c8aac8a2", wait_until="networkidle", timeout=30000)
    time.sleep(5)
    
    # Take full page screenshot
    page.screenshot(path=r"E:\cbse-chatbot\canvas_full_page.png", full_page=True)
    
    # Try clicking "Edit with ChatGPT" or finding the code content
    # Look for the code editor content
    cm = page.query_selector(".cm-content")
    if cm:
        print("=== CODE MIRROR CONTENT ===")
        print(cm.inner_text()[:10000])
    
    pm = page.query_selector(".ProseMirror")
    if pm:
        print("=== PROSEMIRROR CONTENT ===")
        print(pm.inner_text()[:10000])
    
    # Try to find iframe or rendered preview
    iframes = page.query_selector_all("iframe")
    print(f"\nFound {len(iframes)} iframes")
    for i, iframe in enumerate(iframes):
        src = iframe.get_attribute("src") or "no src"
        print(f"  iframe[{i}]: {src[:200]}")
        frame = iframe.content_frame()
        if frame:
            html = frame.content()
            print(f"  iframe[{i}] content length: {len(html)}")
            if len(html) > 200:
                with open(rf"E:\cbse-chatbot\canvas_iframe_{i}.html", "w", encoding="utf-8") as f:
                    f.write(html)
                print(f"  Saved to canvas_iframe_{i}.html")
    
    # Also scroll down and take another screenshot
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(2)
    page.screenshot(path=r"E:\cbse-chatbot\canvas_bottom.png")
    
    browser.close()
    print("\nDone!")
