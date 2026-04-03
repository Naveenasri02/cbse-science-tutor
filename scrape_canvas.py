from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("https://chatgpt.com/canvas/shared/69cf3e4f2ddc8191b5da5766c8aac8a2", wait_until="networkidle", timeout=30000)
    time.sleep(5)
    
    # Try to find the canvas content
    # Look for code blocks or rendered content
    content = page.content()
    
    # Save full HTML
    with open(r"E:\cbse-chatbot\canvas_full.html", "w", encoding="utf-8") as f:
        f.write(content)
    
    # Try to extract text content from main area
    selectors = [
        "pre", "code", ".code-block", ".canvas-content",
        "[data-testid]", ".prose", ".markdown", 
        ".ProseMirror", ".cm-content", ".cm-editor",
        ".flex.grow", "main", "article"
    ]
    
    for sel in selectors:
        els = page.query_selector_all(sel)
        if els:
            for i, el in enumerate(els):
                text = el.inner_text()
                if len(text) > 100:
                    print(f"\n=== {sel} [{i}] ({len(text)} chars) ===")
                    print(text[:3000])
    
    # Also take a screenshot
    page.screenshot(path=r"E:\cbse-chatbot\canvas_screenshot.png", full_page=True)
    print("\nScreenshot saved!")
    
    browser.close()
