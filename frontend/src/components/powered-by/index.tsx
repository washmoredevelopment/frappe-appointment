interface PoweredByProps {
  appLogo?: string;
}

const PoweredBy = ({ appLogo }: PoweredByProps) => {
  return (
    <div className="flex items-center w-full justify-center py-5 max-md:pb-20 max-lg:py-2">
      {appLogo ? (
        <img 
          src={appLogo} 
          alt="Logo" 
          className="h-8 w-auto object-contain opacity-70 hover:opacity-100 transition-opacity"
        />
      ) : (
        <div className="h-8" /> 
      )}
    </div>
  );
};

export default PoweredBy;
