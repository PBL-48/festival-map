import csv
import json
from pathlib import Path


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    json_path = base_dir / "stalls.json"
    csv_path = base_dir / "stalls.csv"

    with json_path.open("r", encoding="utf-8") as f:
        json_data = json.load(f)

    data = [
        [
            "name",
            "place",
            "owner",
            "content",
        ]
    ]
    for stall in json_data["content"]:
        data.append(
            [
                stall["project"]["name"]["formal"],
                stall["project"]["schedule"][0]["place"]["ja"],
                stall["group"]["name"]["formal"],
                stall["project"]["category"][0],
            ]
        )

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerows(data)


if __name__ == "__main__":
    main()
