from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto("https://chatgpt.com/canvas/shared/69cf3e4f2ddc8191b5da5766c8aac8a2", wait_until="networkidle", timeout=30000)
    time.sleep(8)
    
    # Get the outer iframe (sandbox)
    outer_frames = page.frames
    print(f"Total frames: {len(outer_frames)}")
    for i, f in enumerate(outer_frames):
        print(f"  Frame {i}: {f.name} url={f.url[:100]}")
    
    # Look for nested iframe #root inside the sandbox iframe
    for f in outer_frames:
        if "sandbox" in f.url or "oaiusercontent" in f.url:
            print(f"\nFound sandbox frame: {f.url[:100]}")
            # Wait for nested iframe
            time.sleep(3)
            root_iframe = f.query_selector("#root")
            if root_iframe:
                inner_frame = root_iframe.content_frame()
                if inner_frame:
                    html = inner_frame.content()
                    print(f"Inner frame content: {len(html)} chars")
                    with open(r"E:\cbse-chatbot\canvas_inner.html", "w", encoding="utf-8") as f2:
                        f2.write(html)
                    print("Saved to canvas_inner.html")
                else:
                    print("No content_frame for #root")
            else:
                # Try getting all inner frames
                sub_frames = f.child_frames
                print(f"Child frames: {len(sub_frames)}")
                for j, sf in enumerate(sub_frames):
                    html = sf.content()
                    print(f"  Sub frame {j}: {len(html)} chars")
                    if len(html) > 200:
                        with open(rf"E:\cbse-chatbot\canvas_sub_{j}.html", "w", encoding="utf-8") as f2:
                            f2.write(html)
                        print(f"  Saved to canvas_sub_{j}.html")
    
    browser.close()
