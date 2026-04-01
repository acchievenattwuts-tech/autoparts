interface OgImageTemplateProps {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: string;
}

const OgImageTemplate = ({
  eyebrow = "ศรีวรรณ อะไหล่แอร์",
  title,
  description,
  meta,
}: OgImageTemplateProps) => {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background:
          "linear-gradient(135deg, #0f2140 0%, #17335e 54%, #f97316 140%)",
        color: "white",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at top left, rgba(249,115,22,0.30), transparent 28%), radial-gradient(circle at bottom right, rgba(255,255,255,0.10), transparent 24%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: -120,
          right: -100,
          width: 340,
          height: 340,
          borderRadius: 9999,
          background: "rgba(255,255,255,0.08)",
        }}
      />

      <div
        style={{
          position: "absolute",
          bottom: -160,
          left: -100,
          width: 360,
          height: 360,
          borderRadius: 9999,
          background: "rgba(255,255,255,0.06)",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          padding: "72px 76px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 960,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              alignSelf: "flex-start",
              gap: 12,
              padding: "12px 22px",
              borderRadius: 9999,
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.14)",
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 9999,
              background: "#f97316",
            }}
          />
            <span>{eyebrow}</span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <h1
              style={{
                margin: 0,
                fontSize: 72,
                lineHeight: 1.04,
                fontWeight: 800,
                letterSpacing: "-0.04em",
              }}
            >
              {title}
            </h1>
            {description ? (
              <p
                style={{
                  margin: 0,
                  maxWidth: 920,
                  fontSize: 32,
                  lineHeight: 1.45,
                  color: "rgba(255,255,255,0.82)",
                }}
              >
                {description}
              </p>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 26,
              color: "rgba(255,255,255,0.72)",
            }}
          >
            <span>www.sriwanparts.com</span>
            {meta ? (
              <>
                <span style={{ color: "rgba(255,255,255,0.28)" }}>•</span>
                <span>{meta}</span>
              </>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 22px",
              borderRadius: 9999,
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.14)",
              fontSize: 24,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                display: "flex",
                width: 18,
                height: 18,
                borderRadius: 9999,
                background: "#06C755",
              }}
            />
            <span>ค้นหาเร็ว • คุยต่อผ่าน LINE OA</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OgImageTemplate;
