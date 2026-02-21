import os
from PIL import Image, ImageDraw

def generate_attention_icon():
    base_dir = r"c:\_cloud\__cfab_demon\assets"
    icon_path = os.path.join(base_dir, "icon.ico")
    out_path = os.path.join(base_dir, "icon_attention.ico")

    if not os.path.exists(icon_path):
        print(f"Error: {icon_path} does not exist.")
        return

    # Load the original icon. `.ico` files usually have multiple sizes, we'll
    # modify the largest/most common ones and save them back.
    img = Image.open(icon_path)
    
    # Extract all frames (sizes) from the ico file.
    frames = []
    
    # Try reading frames
    try:
        while True:
            # Copy the current frame
            frame = img.copy().convert("RGBA")
            
            # Draw a warning dot (e.g. orange/amber) on the top right
            width, height = frame.size
            
            # Let's make the dot about 1/3 of the icon size
            dot_size = int(min(width, height) * 0.35)
            
            # Position: Top right corner
            # We'll leave a small margin
            margin_x = int(width * 0.1)
            margin_y = int(height * 0.1)
            
            x1 = width - dot_size - margin_x
            y1 = margin_y
            x2 = width - margin_x
            y2 = margin_y + dot_size
            
            draw = ImageDraw.Draw(frame)
            
            # Draw an amber circle with a slight white border for visibility
            bbox_outer = [x1 - 1, y1 - 1, x2 + 1, y2 + 1]
            bbox_inner = [x1, y1, x2, y2]
            
            # Outline/border
            draw.ellipse(bbox_outer, fill=(255, 255, 255, 255))
            
            # Inner circle (Amber/Orange)
            draw.ellipse(bbox_inner, fill=(245, 158, 11, 255))
            
            frames.append(frame)
            
            img.seek(img.tell() + 1)
    except EOFError:
        pass  # We've reached the end of the frames
    
    # Save the new ico file with all frames
    if frames:
        frames[0].save(
            out_path,
            format="ICO",
            sizes=[(f.width, f.height) for f in frames],
            append_images=frames[1:]
        )
        print(f"Successfully created {out_path} with {len(frames)} frames.")
    else:
        print("Failed to extract any frames from the original icon.")

if __name__ == "__main__":
    generate_attention_icon()
