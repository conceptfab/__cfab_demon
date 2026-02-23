import os

appdata = os.environ.get('APPDATA')
timeflow_dir = os.path.join(appdata, 'TimeFlow')

if os.path.exists(timeflow_dir):
    print(f"Content of {timeflow_dir}:")
    for f in os.listdir(timeflow_dir):
        if f.endswith('.db'):
            path = os.path.join(timeflow_dir, f)
            size = os.path.getsize(path)
            print(f"{f}: {size / (1024*1024):.2f} MB")
else:
    print(f"Directory {timeflow_dir} does not exist.")
